import { afterEach, describe, expect, it, vi } from "vitest"

import {
  applyLoopEventToStep,
  clearLiveStepFields,
  createThrottledUpdate,
  formatElapsed,
  isStale,
  LIVE_UPDATE_MS,
} from "@/lib/workflows/live"
import type { StepRun } from "@/lib/workflows/schema"

function step(overrides: Partial<StepRun> = {}): StepRun {
  return {
    id: "plan",
    agent: "planner",
    status: "running",
    attempts: 1,
    toolExecutions: [],
    filesChanged: [],
    ...overrides,
  }
}

describe("isStale", () => {
  it("is false when there is no last activity", () => {
    expect(isStale(undefined, Date.now())).toBe(false)
  })

  it("is true after the threshold", () => {
    const now = Date.parse("2026-10-19T12:00:00.000Z")
    expect(isStale("2026-10-19T11:58:00.000Z", now, 90_000)).toBe(true)
    expect(isStale("2026-10-19T11:59:30.000Z", now, 90_000)).toBe(false)
  })
})

describe("formatElapsed", () => {
  it("formats seconds and minutes", () => {
    expect(formatElapsed(5_000)).toBe("5s")
    expect(formatElapsed(125_000)).toBe("2m 5s")
    expect(formatElapsed(3_661_000)).toBe("1h 1m")
  })
})

describe("createThrottledUpdate", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("limits how often update runs and flushes at the end", async () => {
    vi.useFakeTimers()
    const update = vi.fn(async () => undefined)
    const live = createThrottledUpdate(update, LIVE_UPDATE_MS)
    live.notify()
    live.notify()
    live.notify()
    expect(update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(LIVE_UPDATE_MS)
    expect(update).toHaveBeenCalledTimes(1)
    live.notify()
    await live.flush()
    expect(update).toHaveBeenCalledTimes(2)
  })
})

describe("applyLoopEventToStep", () => {
  it("tracks turns, activity, recent lines, and live tool traces", () => {
    const s = step()
    const at = new Date("2026-10-19T12:00:00.000Z")
    applyLoopEventToStep(s, { type: "turn_start", turn: 0, maxTurns: 10 }, at)
    expect(s.turn).toBe(1)
    expect(s.maxTurns).toBe(10)
    expect(s.activity?.kind).toBe("waiting_model")

    applyLoopEventToStep(
      s,
      {
        type: "tool_call",
        id: "c1",
        tool: "fs_read",
        server: "builtin",
        args: { path: "a.md" },
        risk: "read",
      },
      new Date("2026-10-19T12:00:01.000Z")
    )
    expect(s.activity?.kind).toBe("running_tool")
    expect(s.activity?.label).toContain("fs_read")

    applyLoopEventToStep(
      s,
      {
        type: "tool_result",
        trace: {
          id: "c1",
          server: "builtin",
          tool: "fs_read",
          args: { path: "a.md" },
          result: { ok: true },
          durationMs: 12,
        },
      },
      new Date("2026-10-19T12:00:02.000Z")
    )
    expect(s.toolExecutions).toHaveLength(1)
    expect(s.toolExecutions[0].tool).toBe("fs_read")
    expect(s.recent?.some((e) => e.text.includes("finished"))).toBe(true)

    applyLoopEventToStep(s, { type: "empty_retry", turn: 2 }, new Date("2026-10-19T12:00:03.000Z"))
    expect(s.activity?.label).toBe("Asking the model once more…")
    expect(s.recent?.some((e) => e.text.includes("empty"))).toBe(true)

    clearLiveStepFields(s)
    expect(s.activity).toBeUndefined()
    expect(s.recent).toBeUndefined()
    expect(s.toolExecutions).toHaveLength(1)
  })
})
