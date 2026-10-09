import { z } from "zod"

import { findArtifact, scanWorkspace } from "@/lib/artifacts/parser"
import { nameSchema } from "@/lib/artifacts/schemas"
import type { Artifact } from "@/lib/artifacts/types"
import { loadBrainContext } from "@/lib/brain/context"
import { readConfig } from "@/lib/config"
import { loadDecisionClient } from "@/lib/decision/client"
import { buildAgentPersonaContext, buildSystemContext } from "@/lib/llm/context"
import { getVerifiedCredentials, CredentialStateError } from "@/lib/llm/credentials"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import type { ChatMessage, LLMCredentials, LLMProvider } from "@/lib/llm/types"
import type { ProviderSecret } from "@/lib/secrets"
import { readAiSettings } from "@/lib/settings"
import { createApprovalPolicy } from "@/lib/runtime/approval-policy"
import { runAgentLoop, type AgentLoopResult } from "@/lib/runtime/agent-loop"
import type { Approver } from "@/lib/runtime/ask-user"
import { agentToolScope, ASSISTANT_TOOL_SCOPE, buildToolset } from "@/lib/runtime/tools"
import type { AgentLoopEvent, RuntimeTool } from "@/lib/runtime/types"

import { selectTurnArtifacts, type TurnArtifactSelection } from "./turn-artifacts"

export const chatRequestSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1, "At least one message is required"),
  temperature: z.number().finite().min(0).max(2).optional(),
  agent: nameSchema.optional(),
  /** Auto-approve every write-risk call for this message (exec still asks). */
  allowWrites: z.boolean().optional(),
  /** Auto-approve builtin file writes for this message (protected paths still ask). */
  allowFileWrites: z.boolean().optional(),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

export interface PreparedChat {
  provider: LLMProvider
  model: string
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
  const provider = getProvider(request.provider)
  if (!provider) return { ok: false, message: "Unknown provider", status: 400 }
  const model = request.model?.trim() || provider.models[0]
  if (!model) return { ok: false, message: "A model is required for this provider", status: 400 }

  const config = await readConfig()
  const root = config.currentPath ?? null
  let persona: Artifact | undefined
  if (request.agent) {
    const agent = root ? await findArtifact(root, "agent", request.agent) : null
    if (!agent) return { ok: false, message: `Agent "${request.agent}" was not found`, status: 404 }
    persona = agent
  }

  let verified: Awaited<ReturnType<typeof getVerifiedCredentials>>
  try {
    verified = await getVerifiedCredentials(provider)
  } catch (error) {
    if (error instanceof CredentialStateError) {
      return { ok: false, message: error.message, status: error.status }
    }
    throw error
  }

  const [all, resolved, settings] = await Promise.all([
    root ? scanWorkspace(root) : Promise.resolve([] as Artifact[]),
    loadDecisionClient(),
    readAiSettings(),
  ])
  const message = lastUserMessage(request.messages)
  const selection = await selectTurnArtifacts({ message, all, persona, resolved })

  const sections = [persona ? buildAgentPersonaContext(persona) : await buildSystemContext()]
  if (selection.prompt) sections.push(selection.prompt)
  if (root) {
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

export function runChat(
  chat: PreparedChat,
  options: { approve: Approver; onEvent?: (event: AgentLoopEvent) => void; signal?: AbortSignal }
): Promise<AgentLoopResult> {
  const messages: ChatMessage[] = chat.request.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))
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
    policy: createApprovalPolicy(Boolean(chat.request.allowWrites), chat.allowFileWrites),
    approve: options.approve,
    onEvent: options.onEvent,
    signal: options.signal,
  })
}
