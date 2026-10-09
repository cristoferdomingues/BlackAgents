import type {
  ChatMessage,
  LLMCredentials,
  LLMProvider,
  LLMToolDefinition,
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
  RuntimeTool,
  ToolExecutionTrace,
} from "./types"

export const DEFAULT_MAX_TURNS = 8
export const MAX_TURNS_LIMIT = 20
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000
export const MAX_TOOL_RESULT_CHARS = 12_000

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
  workspaceRoot: string
  policy: ApprovalPolicy
  /** Ask the user about a call that needs approval. */
  approve: (tool: RuntimeTool, args: Record<string, unknown>) => Promise<ApprovalDecision>
  onEvent?: (event: AgentLoopEvent) => void
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
  const toolMap = new Map(options.tools.map((t) => [t.name, t]))
  const definitions = options.tools.map(toDefinition)
  const messages: ChatMessage[] = [...options.messages]
  const toolExecutions: ToolExecutionTrace[] = []
  let content = ""

  for (let turn = 0; turn < maxTurns; turn++) {
    checkAborted(options.signal)
    const result = await options.provider.generate(
      {
        model: options.model,
        messages,
        temperature: options.temperature,
        systemContext: options.systemContext,
        tools: definitions.length > 0 ? definitions : undefined,
      },
      options.credentials
    )
    content = result.content
    if (content) options.onEvent?.({ type: "token", turn, content })

    if (!result.toolCalls || result.toolCalls.length === 0) {
      return { content, toolExecutions, messages, turns: turn + 1, stoppedAtLimit: false }
    }

    messages.push({ role: "assistant", content, tool_calls: result.toolCalls })
    for (const call of result.toolCalls) {
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
  }

  checkAborted(options.signal)
  const final = await options.provider.generate(
    {
      model: options.model,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "The tool-call limit for this turn was reached. Give your best final answer now, without calling tools, and say what is still left to do.",
        },
      ],
      temperature: options.temperature,
      systemContext: options.systemContext,
      // Anthropic rejects tool history without tool definitions; any new
      // calls in this reply are ignored.
      tools: definitions.length > 0 ? definitions : undefined,
    },
    options.credentials
  )
  content = final.content || "I reached the tool-call limit before finishing."
  if (content) options.onEvent?.({ type: "token", turn: maxTurns, content })
  return { content, toolExecutions, messages, turns: maxTurns, stoppedAtLimit: true }
}
