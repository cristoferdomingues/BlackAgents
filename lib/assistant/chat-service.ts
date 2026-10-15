import { z } from "zod"

import { findBuiltinArtifact, withBuiltinArtifacts } from "@/lib/artifacts/builtin"
import { findArtifact, scanWorkspace } from "@/lib/artifacts/parser"
import { artifactInputSchema, nameSchema } from "@/lib/artifacts/schemas"
import { draftToArtifact } from "@/lib/artifacts/serializer"
import type { Artifact } from "@/lib/artifacts/types"
import { loadBrainContext } from "@/lib/brain/context"
import {
  attachmentsSchema,
  isBinaryAttachment,
  renderTextAttachments,
} from "@/lib/chat/attachments"
import { readConfig } from "@/lib/config"
import { loadDecisionClient } from "@/lib/decision/client"
import { composeFilesPrompt, parseFileMentions, resolveWorkspaceFiles } from "@/lib/files"
import { buildAgentPersonaContext, buildSystemContext } from "@/lib/llm/context"
import { getVerifiedCredentials, CredentialStateError } from "@/lib/llm/credentials"
import {
  agentModelLayer,
  ModelRefError,
  selectLayeredModel,
  resolveTaskRef,
  unverifiedProviderMessage,
  type ModelLayer,
  type ModelSource,
} from "@/lib/llm/model-ref"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import type { ChatModelTask } from "@/lib/llm/task-models"
import type { ChatMessage, LLMCredentials, LLMProvider, ProviderId } from "@/lib/llm/types"
import type { ProviderSecret } from "@/lib/secrets"
import { readAiSettings } from "@/lib/settings"
import { loadAutoAcceptedFlows } from "@/lib/browser"
import { createApprovalPolicy, preapprovedCallKey } from "@/lib/runtime/approval-policy"
import { runAgentLoop, type AgentLoopResult } from "@/lib/runtime/agent-loop"
import type { Approver } from "@/lib/runtime/ask-user"
import { agentToolScope, ASSISTANT_TOOL_SCOPE, buildToolset } from "@/lib/runtime/tools"
import type { AgentLoopEvent, RuntimeTool } from "@/lib/runtime/types"

import {
  composeDraftPrompt,
  selectTurnArtifacts,
  type TurnArtifactSelection,
} from "./turn-artifacts"

export const chatRequestSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        attachments: attachmentsSchema.optional(),
      })
    )
    .min(1, "At least one message is required"),
  temperature: z.number().finite().min(0).max(2).optional(),
  agent: nameSchema.optional(),
  /** An unsaved artifact from the editor: an agent becomes the persona; others join the context. */
  draft: artifactInputSchema.optional(),
  /** Auto-approve every write-risk call for this message (exec still asks). */
  allowWrites: z.boolean().optional(),
  /** Auto-approve builtin file writes for this message (protected paths still ask). */
  allowFileWrites: z.boolean().optional(),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

export interface PreparedChat {
  provider: LLMProvider
  model: string
  /** Which layer chose this model. */
  modelSource: ModelSource
  /** Set when the winning layer was `task:<kind>`. */
  modelTask?: ChatModelTask
  credentials: LLMCredentials
  secret: ProviderSecret
  systemContext: string
  tools: RuntimeTool[]
  workspaceRoot: string | null
  selection: TurnArtifactSelection
  maxTurns: number
  /** Builtin `fs_write` may run without an approval card. */
  allowFileWrites: boolean
  request: ChatRequest
}

export type PrepareResult =
  | { ok: true; chat: PreparedChat }
  | { ok: false; message: string; status: number }

function lastUserMessage(messages: ChatRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content
  }
  return ""
}

/**
 * Resolve everything a chat turn needs: provider + verified key, persona,
 * the artifacts loaded for this turn (mentions / Jev / links), the agent's
 * brain notes, and the toolset. Order matters: cheap validation first, MCP
 * servers are only started once credentials are known to be usable.
 */
export async function prepareChat(request: ChatRequest): Promise<PrepareResult> {
  if (!isProviderId(request.provider)) return { ok: false, message: "Unknown provider", status: 400 }
  if (!getProvider(request.provider)) return { ok: false, message: "Unknown provider", status: 400 }

  const config = await readConfig()
  const root = config.currentPath ?? null
  const draft = request.draft ? draftToArtifact(request.draft) : undefined
  let persona: Artifact | undefined
  if (draft?.type === "agent") {
    persona = draft
  } else if (request.agent) {
    const agent =
      (root ? await findArtifact(root, "agent", request.agent) : null) ??
      findBuiltinArtifact("agent", request.agent)
    if (!agent) return { ok: false, message: `Agent "${request.agent}" was not found`, status: 404 }
    persona = agent
  }

  let layers: ModelLayer[]
  try {
    layers = []
    if (persona) layers.push(agentModelLayer(persona))
    const headerModel = request.model?.trim()
    layers.push({
      source: "assistant",
      ref: headerModel
        ? { kind: "id", model: headerModel, provider: request.provider }
        : { kind: "inherit" },
    })
  } catch (error) {
    if (error instanceof ModelRefError) return { ok: false, message: error.message, status: error.status }
    throw error
  }

  const settingsPromise = readAiSettings()
  const needsTask = layers.some((layer) => layer.ref.kind === "task")
  const settingsForTask = needsTask ? await settingsPromise : undefined
  let modelChoice: ReturnType<typeof selectLayeredModel>
  try {
    modelChoice = selectLayeredModel(layers, (task) => {
      if (!settingsForTask) {
        throw new ModelRefError("Set the model in Settings → AI → Models by task", 412, "task_unset")
      }
      return resolveTaskRef(task, settingsForTask)
    })
  } catch (error) {
    if (error instanceof ModelRefError) return { ok: false, message: error.message, status: error.status }
    throw error
  }

  const providerId: ProviderId = modelChoice?.provider ?? request.provider
  const provider = getProvider(providerId)
  if (!provider) return { ok: false, message: "Unknown provider", status: 400 }
  const model = modelChoice?.model || request.model?.trim() || provider.models[0]
  if (!model) return { ok: false, message: "A model is required for this provider", status: 400 }
  const modelSource: ModelSource = modelChoice?.source ?? "assistant"
  const modelTask = modelChoice?.task

  let verified: Awaited<ReturnType<typeof getVerifiedCredentials>>
  try {
    verified = await getVerifiedCredentials(provider)
  } catch (error) {
    if (error instanceof CredentialStateError) {
      if (modelSource === "agent" && persona) {
        return {
          ok: false,
          message: unverifiedProviderMessage({ kind: "agent", name: persona.name }, provider.label),
          status: 412,
        }
      }
      return { ok: false, message: error.message, status: error.status }
    }
    throw error
  }

  const [workspaceArtifacts, resolved, settings] = await Promise.all([
    root ? scanWorkspace(root) : Promise.resolve([] as Artifact[]),
    loadDecisionClient(),
    settingsPromise,
  ])
  // The draft replaces its saved version, so the old text is never loaded beside it.
  const all = withBuiltinArtifacts(workspaceArtifacts).filter(
    (a) => !draft || a.type !== draft.type || a.name !== draft.name
  )
  const message = lastUserMessage(request.messages)
  const selection = await selectTurnArtifacts({ message, all, persona, resolved })

  const sections = [persona ? buildAgentPersonaContext(persona) : await buildSystemContext()]
  if (draft && draft.type !== "agent") sections.push(composeDraftPrompt(draft))
  if (selection.prompt) sections.push(selection.prompt)
  if (root) {
    const fileMentions = new Set<string>()
    for (const msg of request.messages) {
      if (msg.role === "user") {
        for (const name of parseFileMentions(msg.content)) fileMentions.add(name)
      }
    }
    if (fileMentions.size > 0) {
      const workspaceFiles = await resolveWorkspaceFiles(root, [...fileMentions])
      const filesPrompt = composeFilesPrompt(workspaceFiles)
      if (filesPrompt) sections.push(filesPrompt)
    }
    const brain = await loadBrainContext({
      workspaceRoot: root,
      agent: persona?.name,
      task: message,
      resolved,
    })
    if (brain) sections.push(brain)
  }

  const tools = root
    ? await buildToolset(root, persona ? agentToolScope(persona) : ASSISTANT_TOOL_SCOPE)
    : []

  return {
    ok: true,
    chat: {
      provider,
      model,
      modelSource,
      ...(modelTask ? { modelTask } : {}),
      credentials: verified.credentials,
      secret: verified.secret,
      systemContext: sections.join("\n\n"),
      tools,
      workspaceRoot: root,
      selection,
      maxTurns: settings.assistant.maxToolTurns,
      allowFileWrites:
        Boolean(request.allowFileWrites) ||
        (!persona && settings.assistant.autoApproveFileWrites),
      request,
    },
  }
}

/** Text files and YouTube transcripts are quoted data; images and PDFs stay native parts. */
export function toChatMessage(message: ChatRequest["messages"][number]): ChatMessage {
  const attachments = message.role === "user" ? (message.attachments ?? []) : []
  const binary = attachments.filter(isBinaryAttachment)
  return {
    role: message.role,
    content: message.content + renderTextAttachments(attachments),
    ...(binary.length > 0 ? { attachments: binary } : {}),
  }
}

export async function runChat(
  chat: PreparedChat,
  options: { approve: Approver; onEvent?: (event: AgentLoopEvent) => void; signal?: AbortSignal }
): Promise<AgentLoopResult> {
  const messages: ChatMessage[] = chat.request.messages.map(toChatMessage)
  const policy = createApprovalPolicy(Boolean(chat.request.allowWrites), chat.allowFileWrites)
  if (chat.workspaceRoot) {
    const grants = await loadAutoAcceptedFlows(chat.workspaceRoot)
    for (const name of grants.flowNames) policy.autoAcceptFlows.add(name)
    for (const call of grants.calls) {
      policy.autoAcceptedCalls.add(preapprovedCallKey(call.tool, call.args))
    }
  }
  return runAgentLoop({
    provider: chat.provider,
    credentials: chat.credentials,
    model: chat.model,
    messages,
    systemContext: chat.systemContext,
    temperature: chat.request.temperature,
    tools: chat.tools,
    maxTurns: chat.maxTurns,
    workspaceRoot: chat.workspaceRoot ?? process.cwd(),
    policy,
    approve: options.approve,
    onEvent: options.onEvent,
    signal: options.signal,
  })
}
