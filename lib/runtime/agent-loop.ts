import type {
  ChatMessage,
  LLMCredentials,
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
  LLMToolDefinition,
  ToolCall,
} from "@/lib/llm/types"

import {
  needsApproval,
  rememberCall,
  riskOf,
  type ApprovalPolicy,
} from "./approval-policy"
import type {
  AgentLoopEvent,
  ApprovalDecision,
  LlmExchange,
  RuntimeTool,
  ToolExecutionTrace,
} from "./types"

export const DEFAULT_MAX_TURNS = 25
export const MAX_TURNS_LIMIT = 100
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000
export const MAX_TOOL_RESULT_CHARS = 12_000
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 20
export const DEFAULT_MAX_TOTAL_TOOL_CALLS = 100
/** Approx. 50k tokens. Leaves room for provider-specific formatting/output. */
export const DEFAULT_MAX_CONTEXT_CHARS = 200_000

export interface AgentLoopOptions {
  provider: LLMProvider
  credentials: LLMCredentials
  model: string
  messages: ChatMessage[]
  systemContext?: string
  temperature?: number
  tools: RuntimeTool[]
  maxTurns?: number
  toolTimeoutMs?: number
  maxToolCallsPerTurn?: number
  maxTotalToolCalls?: number
  maxContextChars?: number
  workspaceRoot: string
  policy: ApprovalPolicy
  /** Ask the user about a call that needs approval. */
  approve: (tool: RuntimeTool, args: Record<string, unknown>) => Promise<ApprovalDecision>
  onEvent?: (event: AgentLoopEvent) => void
  /** Full prompt/reply for audit logs; not sent on the chat SSE. */
  onLlmExchange?: (exchange: LlmExchange) => void
  signal?: AbortSignal
}

export interface AgentLoopResult {
  content: string
  toolExecutions: ToolExecutionTrace[]
  messages: ChatMessage[]
  turns: number
  /** True when the turn limit cut the tool loop short. */
  stoppedAtLimit: boolean
}

export class LoopAbortedError extends Error {
  constructor() {
    super("The run was cancelled")
    this.name = "LoopAbortedError"
  }
}

export class AgentContextLimitError extends Error {
  constructor() {
    super("The model context is too large even after older tool history was removed")
    this.name = "AgentContextLimitError"
  }
}

/** Keep tool output small enough for the next prompt. */
export function truncateResult(value: unknown, max = MAX_TOOL_RESULT_CHARS): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "null"
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`
}

function toDefinition(tool: RuntimeTool): LLMToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

/** Approximate request size before provider-specific JSON formatting. */
export function estimateContextChars(
  messages: readonly ChatMessage[],
  systemContext: string | undefined,
  definitions: readonly LLMToolDefinition[]
): number {
  return (
    (systemContext?.length ?? 0) +
    JSON.stringify(messages).length +
    JSON.stringify(definitions).length
  )
}

/**
 * Remove the oldest complete assistant-tool exchange until the request fits.
 * Initial caller messages stay intact and tool protocol pairs are never split.
 */
export function compactToolHistory(
  messages: readonly ChatMessage[],
  protectedCount: number,
  systemContext: string | undefined,
  definitions: readonly LLMToolDefinition[],
  maxChars: number
): { messages: ChatMessage[]; removedMessages: number } {
  const next = [...messages]
  let removedMessages = 0
  while (estimateContextChars(next, systemContext, definitions) > maxChars) {
    const start = next.findIndex(
      (message, index) =>
        index >= protectedCount &&
        message.role === "assistant" &&
        Boolean(message.tool_calls?.length)
    )
    if (start < 0) throw new AgentContextLimitError()
    let end = start + 1
    while (end < next.length && next[end].role === "tool") end++
    removedMessages += end - start
    next.splice(start, end - start)
  }
  return { messages: next, removedMessages }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LoopAbortedError()
}

async function runTool(
  tool: RuntimeTool | undefined,
  callId: string,
  name: string,
  args: Record<string, unknown>,
  options: AgentLoopOptions
): Promise<ToolExecutionTrace> {
  const started = Date.now()
  const base = {
    id: callId,
    server: tool?.server ?? "",
    tool: tool?.originalName ?? name,
    args,
  }
  if (!tool) {
    return { ...base, error: `Unknown tool "${name}"`, durationMs: 0 }
  }

  options.onEvent?.({
    type: "tool_call",
    id: callId,
    tool: tool.originalName,
    server: tool.server,
    args,
    risk: riskOf(tool, args),
  })

  if (needsApproval(tool, args, options.policy)) {
    const decision = await options.approve(tool, args)
    checkAborted(options.signal)
    if (!decision.approved) {
      return {
        ...base,
        error: decision.reason ?? "The user denied this tool call",
        durationMs: 0,
      }
    }
    if (decision.remember) rememberCall(options.policy, tool, args)
    if (decision.fileWritePermission) options.policy.allowFileWrites = true
  }

  try {
    const outcome = await withTimeout(
      tool.execute(args, {
        workspaceRoot: options.workspaceRoot,
        signal: options.signal,
      }),
      tool.timeoutMs ?? options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      `Tool "${tool.originalName}"`
    )
    return {
      ...base,
      result: outcome.result,
      error: outcome.error,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  }
}

async function generateTurn(
  options: AgentLoopOptions,
  turn: number,
  maxTurns: number,
  messages: ChatMessage[],
  definitions: LLMToolDefinition[]
): Promise<LLMGenerateResult> {
  options.onEvent?.({ type: "turn_start", turn, maxTurns })
  options.onEvent?.({ type: "llm_request", turn, messageCount: messages.length })
  const request: LLMGenerateRequest = {
    model: options.model,
    messages,
    temperature: options.temperature,
    systemContext: options.systemContext,
    tools: definitions.length > 0 ? definitions : undefined,
  }
  const started = Date.now()
  const result = await options.provider.generate(request, options.credentials, options.signal)
  const durationMs = Date.now() - started
  options.onEvent?.({
    type: "llm_response",
    turn,
    durationMs,
    toolCallCount: result.toolCalls?.length ?? 0,
    ...(result.usage ? { usage: result.usage } : {}),
  })
  options.onLlmExchange?.({
    turn,
    model: options.model,
    systemContext: options.systemContext,
    messages: structuredClone(messages),
    content: result.content,
    reasoning: result.reasoning,
    // Keep audit files bounded even when a provider returns a runaway list.
    toolCalls: result.toolCalls?.slice(
      0,
      options.maxTotalToolCalls ?? DEFAULT_MAX_TOTAL_TOOL_CALLS
    ),
    durationMs,
    usage: result.usage,
  })
  return result
}

/**
 * The one bounded tool loop used by chat and workflow steps:
 * generate → run tool calls (with approval) → feed results back, at most
 * `maxTurns` times. When the limit is hit, one last call without tools asks
 * the model for a final answer. Provider errors propagate to the caller.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxTurns = Math.min(
    Math.max(1, options.maxTurns ?? DEFAULT_MAX_TURNS),
    MAX_TURNS_LIMIT
  )
  const maxPerTurn = Math.max(
    1,
    options.maxToolCallsPerTurn ?? DEFAULT_MAX_TOOL_CALLS_PER_TURN
  )
  const maxTotal = Math.max(
    1,
    options.maxTotalToolCalls ?? DEFAULT_MAX_TOTAL_TOOL_CALLS
  )
  const maxContextChars = Math.max(
    1,
    options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS
  )
  const toolMap = new Map(options.tools.map((t) => [t.name, t]))
  const definitions = options.tools.map(toDefinition)
  const protectedCount = options.messages.length
  let messages: ChatMessage[] = [...options.messages]
  const toolExecutions: ToolExecutionTrace[] = []
  let content = ""
  let limitMessage =
    "The tool-call turn limit was reached. Give your best final answer now, without calling tools, and say what is still left to do."
  let turnsUsed = 0

  for (let turn = 0; turn < maxTurns; turn++) {
    checkAborted(options.signal)
    const compacted = compactToolHistory(
      messages,
      protectedCount,
      options.systemContext,
      definitions,
      maxContextChars
    )
    messages = compacted.messages
    if (compacted.removedMessages > 0) {
      options.onEvent?.({
        type: "context_compacted",
        turn,
        removedMessages: compacted.removedMessages,
      })
    }
    const result = await generateTurn(options, turn, maxTurns, messages, definitions)
    turnsUsed = turn + 1
    content = result.content
    if (result.reasoning) options.onEvent?.({ type: "thinking", turn, content: result.reasoning })
    if (content) options.onEvent?.({ type: "token", turn, content })

    if (!result.toolCalls || result.toolCalls.length === 0) {
      return { content, toolExecutions, messages, turns: turn + 1, stoppedAtLimit: false }
    }

    const remaining = Math.max(0, maxTotal - toolExecutions.length)
    const selected = selectToolCalls(result.toolCalls, Math.min(maxPerTurn, remaining))
    const hitTotal = selected.calls.length > 0 && selected.calls.length >= remaining
    const limited =
      selected.calls.length < result.toolCalls.length ||
      selected.duplicates > 0 ||
      remaining === 0 ||
      hitTotal
    if (limited) {
      options.onEvent?.({
        type: "tool_limit",
        turn,
        requested: result.toolCalls.length,
        accepted: selected.calls.length,
        duplicates: selected.duplicates,
        reason: hitTotal || remaining === 0 ? "total" : "per_turn",
      })
      limitMessage =
        `A safety limit stopped the tool loop after accepting ${selected.calls.length} of ` +
        `${result.toolCalls.length} requested calls (${selected.duplicates} duplicates removed). ` +
        "Give your best final answer now without calling tools, and say what remains."
    }

    if (selected.calls.length > 0) {
      messages.push({ role: "assistant", content, tool_calls: selected.calls })
    }
    for (const call of selected.calls) {
      checkAborted(options.signal)
      const trace = await runTool(
        toolMap.get(call.name),
        call.id,
        call.name,
        call.arguments,
        options
      )
      toolExecutions.push(trace)
      options.onEvent?.({ type: "tool_result", trace })
      messages.push({
        role: "tool",
        name: call.name,
        tool_call_id: call.id,
        content: truncateResult(
          trace.error ? { error: trace.error } : trace.result ?? null
        ),
      })
    }
    if (limited) break
  }

  checkAborted(options.signal)
  let finalMessages: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content: limitMessage,
    },
  ]
  const compacted = compactToolHistory(
    finalMessages,
    protectedCount,
    options.systemContext,
    definitions,
    maxContextChars
  )
  finalMessages = compacted.messages
  if (compacted.removedMessages > 0) {
    options.onEvent?.({
      type: "context_compacted",
      turn: turnsUsed,
      removedMessages: compacted.removedMessages,
    })
  }
  const final = await generateTurn(options, turnsUsed, maxTurns, finalMessages, definitions)
  if (final.reasoning) {
    options.onEvent?.({ type: "thinking", turn: turnsUsed, content: final.reasoning })
  }
  content = final.content || "A safety limit stopped the tool loop before it finished."
  if (content) options.onEvent?.({ type: "token", turn: turnsUsed, content })
  return { content, toolExecutions, messages, turns: turnsUsed, stoppedAtLimit: true }
}

function selectToolCalls(
  calls: readonly ToolCall[],
  limit: number
): { calls: ToolCall[]; duplicates: number } {
  const selected: ToolCall[] = []
  const seen = new Set<string>()
  let duplicates = 0
  for (const call of calls) {
    const key = `${call.name}:${JSON.stringify(call.arguments)}`
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    if (selected.length < limit) selected.push(call)
  }
  return { calls: selected, duplicates }
}
