import type { LLMCredentials, LLMProvider, ChatMessage } from "@/lib/llm/types"
import { getProvider } from "@/lib/llm/registry"
import { getVerifiedCredentials } from "@/lib/llm/credentials"
import { runAgentLoop, LoopAbortedError } from "@/lib/runtime/agent-loop"
import { createApprovalPolicy } from "@/lib/runtime/approval-policy"
import { createRegistryApprover } from "@/lib/runtime/ask-user"
import { codingTools, type CodingBuffer } from "@/lib/runtime/tools/code"
import type { SseSend } from "@/lib/sse"
import { readAiSettings } from "@/lib/settings"

import { K0dingError } from "./errors"
import { guidancePrompt } from "./guidance"
import { K0DING_LIMITS } from "./limits"
import { readProjectNotes } from "./notes"
import { K0DING_SYSTEM, projectNotesPrompt } from "./prompt"
import type { CodeRoot, CodingSession } from "./schema"
import { saveCodingSession } from "./sessions"

export async function openCodingProvider(model: CodingSession["model"]): Promise<{
  provider: LLMProvider
  credentials: LLMCredentials
}> {
  const provider = getProvider(model.provider)
  if (!provider) throw new K0dingError("Unknown provider")
  const verified = await getVerifiedCredentials(provider)
  return { provider, credentials: verified.credentials }
}

function toStored(messages: readonly ChatMessage[]): CodingSession["messages"] {
  const stored: CodingSession["messages"] = []
  for (const message of messages) {
    if (message.role === "system") continue
    stored.push({
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    })
  }
  return stored.slice(-K0DING_LIMITS.maxSessionMessages)
}

/** Run one K0ding turn. Tool writes are staged on the session and are not written to disk. */
export async function runCodingTurn(input: {
  workspace: string
  scope?: string
  codeRoot: CodeRoot
  session: CodingSession
  provider: LLMProvider
  credentials: LLMCredentials
  send: SseSend
  signal: AbortSignal
}): Promise<CodingSession> {
  const buffer: CodingBuffer = {
    root: input.codeRoot,
    changes: [...input.session.changes],
    ...(input.session.noteProposal ? { noteProposal: input.session.noteProposal } : {}),
  }
  const tools = codingTools(buffer)
  const settings = await readAiSettings()
  const notes = await readProjectNotes(input.workspace, input.scope, input.codeRoot.id)
  const guidance = await guidancePrompt(input.workspace, input.scope, input.session.guidance)
  const systemContext = [K0DING_SYSTEM, projectNotesPrompt(notes), guidance].filter(Boolean).join("\n\n")
  const policy = createApprovalPolicy(false, false)
  for (const key of input.session.allowedCalls) policy.allowedCalls.add(key)
  const allowedCalls = (): string[] => [...policy.allowedCalls]
  try {
    const result = await runAgentLoop({
      provider: input.provider,
      credentials: input.credentials,
      model: input.session.model.model,
      messages: input.session.messages as ChatMessage[],
      systemContext,
      tools,
      maxTurns: settings.assistant.maxToolTurns,
      workspaceRoot: input.workspace,
      policy,
      approve: createRegistryApprover({
        scope: { kind: "chat" },
        signal: input.signal,
        onRequest: (request) => {
          input.send("approval_required", { approval: request })
        },
        onResolved: (request, decision) => {
          input.send("approval_resolved", { id: request.id, approved: decision.approved })
        },
      }),
      signal: input.signal,
      onEvent: (event) => {
        if (event.type === "token") input.send("token", { content: event.content })
        if (event.type === "tool_call") {
          const tool = tools.find((item) => item.name === event.tool)
          input.send("tool", { tool: event.tool, summary: tool?.summarize?.(event.args) ?? event.tool })
        }
        if (event.type === "tool_result" && event.trace.error) {
          input.send("tool_result", { tool: event.trace.tool, error: event.trace.error })
        }
      },
    })
    return await saveCodingSession(input.workspace, input.scope, {
      ...input.session,
      status: "review",
      messages: toStored(result.messages),
      changes: buffer.changes,
      ...(buffer.noteProposal ? { noteProposal: buffer.noteProposal } : {}),
      allowedCalls: allowedCalls(),
    })
  } catch (err) {
    const status = err instanceof LoopAbortedError ? "interrupted" : "failed"
    await saveCodingSession(input.workspace, input.scope, {
      ...input.session,
      status,
      changes: buffer.changes,
      ...(buffer.noteProposal ? { noteProposal: buffer.noteProposal } : {}),
      allowedCalls: allowedCalls(),
    }).catch(() => undefined)
    throw err
  }
}
