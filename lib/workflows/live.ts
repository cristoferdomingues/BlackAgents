import type { AgentLoopEvent } from "@/lib/runtime/types"

import type { ActivityEntry, StepActivity, StepRun } from "./schema"

export const LIVE_UPDATE_MS = 1_000
export const STALE_ACTIVITY_MS = 90_000
export const MAX_RECENT_ENTRIES = 8

/** True when nothing has happened for longer than `thresholdMs`. */
export function isStale(
  lastActivityAt: string | undefined,
  now: number,
  thresholdMs = STALE_ACTIVITY_MS
): boolean {
  if (!lastActivityAt) return false
  const at = Date.parse(lastActivityAt)
  if (Number.isNaN(at)) return false
  return now - at >= thresholdMs
}

/** Format a duration in plain words (e.g. "12s", "2m 5s"). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/**
 * Save/emit at most once per `intervalMs`, plus a final flush.
 * Coalesces rapid agent-loop events so the run file and SSE stay light.
 */
export function createThrottledUpdate(
  update: () => Promise<void>,
  intervalMs = LIVE_UPDATE_MS
): { notify: () => void; flush: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  let inFlight: Promise<void> | null = null
  let closed = false

  const run = async (): Promise<void> => {
    pending = false
    inFlight = update().finally(() => {
      inFlight = null
    })
    await inFlight
    if (pending && !closed) schedule()
  }

  const schedule = (): void => {
    if (timer !== undefined || closed) return
    timer = setTimeout(() => {
      timer = undefined
      void run()
    }, intervalMs)
  }

  return {
    notify(): void {
      if (closed) return
      pending = true
      schedule()
    },
    async flush(): Promise<void> {
      closed = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (inFlight) await inFlight
      if (pending) await update()
    },
  }
}

function pushRecent(step: StepRun, text: string, at: string): void {
  const entry: ActivityEntry = { at, text }
  const recent = [...(step.recent ?? []), entry]
  step.recent = recent.length > MAX_RECENT_ENTRIES ? recent.slice(-MAX_RECENT_ENTRIES) : recent
}

function setActivity(step: StepRun, activity: StepActivity, at: string): void {
  step.activity = activity
  step.lastActivityAt = at
}

/** Apply one agent-loop event onto a step's live fields. */
export function applyLoopEventToStep(step: StepRun, event: AgentLoopEvent, now = new Date()): void {
  const at = now.toISOString()
  switch (event.type) {
    case "turn_start":
      step.turn = event.turn + 1
      step.maxTurns = event.maxTurns
      setActivity(
        step,
        { kind: "waiting_model", label: "Waiting for model…", since: at },
        at
      )
      pushRecent(step, `Turn ${event.turn + 1} / ${event.maxTurns}`, at)
      break
    case "llm_request":
      setActivity(
        step,
        { kind: "waiting_model", label: "Waiting for model…", since: at },
        at
      )
      break
    case "llm_response": {
      const seconds = Math.max(1, Math.round(event.durationMs / 1000))
      pushRecent(
        step,
        event.toolCallCount > 0
          ? `Model replied in ${seconds}s (${event.toolCallCount} tool call${event.toolCallCount === 1 ? "" : "s"})`
          : `Model replied in ${seconds}s`,
        at
      )
      step.lastActivityAt = at
      step.activity = { kind: "idle", label: "Model replied", since: at }
      break
    }
    case "thinking":
      step.lastActivityAt = at
      pushRecent(step, "Model is thinking…", at)
      break
    case "token":
      step.lastActivityAt = at
      break
    case "tool_limit":
      step.lastActivityAt = at
      step.activity = { kind: "idle", label: "Tool safety limit reached", since: at }
      pushRecent(
        step,
        `Tool safety limit: accepted ${event.accepted} of ${event.requested} calls`,
        at
      )
      break
    case "context_compacted":
      step.lastActivityAt = at
      pushRecent(step, `Removed ${event.removedMessages} old messages to keep context safe`, at)
      break
    case "tool_call":
      setActivity(
        step,
        { kind: "running_tool", label: `Running \`${event.tool}\`…`, since: at },
        at
      )
      pushRecent(step, `Calling \`${event.tool}\``, at)
      break
    case "tool_result": {
      const name = event.trace.tool
      const ok = !event.trace.error
      pushRecent(step, ok ? `\`${name}\` finished` : `\`${name}\` failed`, at)
      step.lastActivityAt = at
      step.activity = { kind: "idle", label: ok ? `\`${name}\` finished` : `\`${name}\` failed`, since: at }
      const existing = step.toolExecutions.findIndex((t) => t.id === event.trace.id)
      if (existing >= 0) step.toolExecutions[existing] = event.trace
      else step.toolExecutions.push(event.trace)
      break
    }
    case "approval_required":
      setActivity(
        step,
        { kind: "waiting_approval", label: "Waiting for approval…", since: at },
        at
      )
      pushRecent(step, "Needs your approval", at)
      break
    case "approval_resolved":
      step.lastActivityAt = at
      pushRecent(step, event.approved ? "Approval granted" : "Approval denied", at)
      break
  }
}

/** Clear live-only fields when a step ends so finished runs stay small. */
export function clearLiveStepFields(step: StepRun): void {
  delete step.activity
  delete step.turn
  delete step.maxTurns
  delete step.lastActivityAt
  delete step.recent
}
