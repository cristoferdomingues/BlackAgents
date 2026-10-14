import type { ToolExecutionTrace } from "@/lib/mcp/types"

/**
 * The live "what the assistant is thinking" timeline shown while a chat turn
 * streams (isomorphic, display only).
 */
export type ThinkingStep =
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "note"; id: string; text: string }
  | {
      kind: "tool"
      id: string
      tool: string
      server: string
      detail: string
      status: "running" | "done" | "failed"
      durationMs?: number
    }

const DETAIL_MAX = 80

/** A short, one-line hint of what a tool call is about (first text argument). */
export function describeToolArgs(args: Record<string, unknown>): string {
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value.trim()) {
      const line = value.trim().split("\n")[0]
      return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line
    }
  }
  return ""
}

export function addReasoning(steps: ThinkingStep[], text: string): ThinkingStep[] {
  const trimmed = text.trim()
  if (!trimmed) return steps
  return [...steps, { kind: "reasoning", id: `reasoning-${steps.length}`, text: trimmed }]
}

/**
 * A tool call starts. Text the model wrote before calling tools is a working
 * note, not the answer, so it moves into the timeline.
 */
export function addToolCall(
  steps: ThinkingStep[],
  call: { id: string; tool: string; server: string; args: Record<string, unknown> },
  pendingNote: string
): ThinkingStep[] {
  const next = [...steps]
  const note = pendingNote.trim()
  const lastNote = [...next].reverse().find((step) => step.kind === "note")
  if (note && !(lastNote?.kind === "note" && lastNote.text === note)) {
    next.push({ kind: "note", id: `note-${next.length}`, text: note })
  }
  next.push({
    kind: "tool",
    id: call.id,
    tool: call.tool,
    server: call.server,
    detail: describeToolArgs(call.args),
    status: "running",
  })
  return next
}

/** A tool call ends; a result without a matching call is added as finished. */
export function completeToolCall(steps: ThinkingStep[], trace: ToolExecutionTrace): ThinkingStep[] {
  const status = trace.error ? "failed" : "done"
  const index = steps.findIndex((step) => step.kind === "tool" && step.id === trace.id)
  if (index === -1) {
    return [
      ...steps,
      {
        kind: "tool",
        id: trace.id,
        tool: trace.tool,
        server: trace.server,
        detail: describeToolArgs(trace.args),
        status,
        durationMs: trace.durationMs,
      },
    ]
  }
  return steps.map((step, i) =>
    i === index && step.kind === "tool" ? { ...step, status, durationMs: trace.durationMs } : step
  )
}

/** The short headline for the current step. */
export function thinkingHeadline(steps: ThinkingStep[]): string | null {
  const running = [...steps].reverse().find((s) => s.kind === "tool" && s.status === "running")
  if (running && running.kind === "tool") return `Using ${running.tool}`
  if (steps.length > 0) return "Putting the answer together"
  return null
}
