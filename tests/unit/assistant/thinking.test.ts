import { describe, expect, it } from "vitest"

import {
  addReasoning,
  addToolCall,
  completeToolCall,
  describeToolArgs,
  thinkingHeadline,
  type ThinkingStep,
} from "@/lib/assistant/thinking"

const call = { id: "c1", tool: "fs_read", server: "builtin", args: { path: "notes.md" } }

describe("describeToolArgs", () => {
  it("uses the first text argument", () => {
    expect(describeToolArgs({ n: 2, path: "a.md", q: "b" })).toBe("a.md")
  })

  it("keeps one short line", () => {
    const text = describeToolArgs({ q: `${"x".repeat(200)}\nsecond` })
    expect(text).toHaveLength(80)
    expect(text.endsWith("…")).toBe(true)
  })

  it("is empty without text arguments", () => {
    expect(describeToolArgs({ n: 1, flag: true, blank: "  " })).toBe("")
  })
})

describe("thinking steps", () => {
  it("adds reasoning and skips blank text", () => {
    const steps = addReasoning(addReasoning([], "  "), " plan it ")
    expect(steps).toEqual([{ kind: "reasoning", id: "reasoning-0", text: "plan it" }])
  })

  it("moves the interim reply into a note when a tool starts", () => {
    const steps = addToolCall([], call, "Let me read the notes.")
    expect(steps.map((s) => s.kind)).toEqual(["note", "tool"])
    expect(steps[1]).toMatchObject({ status: "running", detail: "notes.md" })
  })

  it("does not repeat the same note for parallel tool calls", () => {
    const first = addToolCall([], call, "Reading.")
    const second = addToolCall(first, { ...call, id: "c2" }, "Reading.")
    expect(second.filter((s) => s.kind === "note")).toHaveLength(1)
  })

  it("marks a tool done or failed when its result arrives", () => {
    const steps = addToolCall([], call, "")
    const done = completeToolCall(steps, { ...call, result: "ok", durationMs: 12 })
    expect(done[0]).toMatchObject({ status: "done", durationMs: 12 })
    const failed = completeToolCall(steps, { ...call, error: "nope" })
    expect(failed[0]).toMatchObject({ status: "failed" })
  })

  it("adds a finished step for a result without a matching call", () => {
    const steps = completeToolCall([], { id: "x", tool: "t", server: "s", args: {}, error: "bad" })
    expect(steps).toEqual([
      { kind: "tool", id: "x", tool: "t", server: "s", detail: "", status: "failed", durationMs: undefined },
    ])
  })
})

describe("thinkingHeadline", () => {
  it("names the running tool, then the final step", () => {
    const running = addToolCall([], call, "")
    expect(thinkingHeadline(running)).toBe("Using fs_read")
    const done: ThinkingStep[] = completeToolCall(running, { ...call })
    expect(thinkingHeadline(done)).toBe("Putting the answer together")
    expect(thinkingHeadline([])).toBeNull()
  })
})
