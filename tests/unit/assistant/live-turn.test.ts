import { describe, expect, it } from "vitest"

import { applyChatEvent, applyUsageEvent, EMPTY_LIVE, type UsageTracker } from "@/lib/assistant/live-turn"
import { EMPTY_SESSION_USAGE } from "@/lib/chat/usage"

const approval = {
  id: "a1",
  tool: "fs_write",
  server: "builtin",
  risk: "write" as const,
  summary: "Write notes.md",
  args: { path: "notes.md" },
  scope: { kind: "chat" as const },
  createdAt: "2026-10-14T10:00:00.000Z",
}

describe("applyChatEvent", () => {
  it("records the loaded artifacts and the model from the context event", () => {
    const live = applyChatEvent(EMPTY_LIVE, {
      event: "context",
      data: {
        artifacts: [{ type: "rule", name: "style", source: "mention" }],
        model: { provider: "openai", model: "gpt-4o-mini", source: "agent" },
      },
    })
    expect(live.artifacts).toEqual([{ type: "rule", name: "style", source: "mention" }])
    expect(live.model).toMatchObject({ model: "gpt-4o-mini" })
  })

  it("replaces the streamed content on token events", () => {
    const one = applyChatEvent(EMPTY_LIVE, { event: "token", data: { content: "Hel" } })
    const two = applyChatEvent(one, { event: "token", data: { content: "Hello" } })
    expect(two.content).toBe("Hello")
  })

  it("moves the text before a tool call into the thinking steps", () => {
    const withText = applyChatEvent(EMPTY_LIVE, { event: "token", data: { content: "Let me look." } })
    const called = applyChatEvent(withText, {
      event: "tool_call",
      data: { id: "c1", tool: "fs_read", server: "builtin", args: { path: "a.md" } },
    })
    expect(called.content).toBe("")
    expect(called.thinking.length).toBeGreaterThan(0)
    const done = applyChatEvent(called, {
      event: "tool_result",
      data: { trace: { id: "c1", server: "builtin", tool: "fs_read", args: { path: "a.md" }, result: "x" } },
    })
    expect(done.thinking).not.toEqual(called.thinking)
  })

  it("adds reasoning from thinking events", () => {
    const live = applyChatEvent(EMPTY_LIVE, { event: "thinking", data: { content: "Planning the steps" } })
    expect(live.thinking.length).toBe(1)
  })

  it("adds and removes approvals", () => {
    const asked = applyChatEvent(EMPTY_LIVE, { event: "approval_required", data: { approval } })
    expect(asked.approvals).toHaveLength(1)
    const resolved = applyChatEvent(asked, { event: "approval_resolved", data: { id: "a1", approved: true } })
    expect(resolved.approvals).toEqual([])
  })

  it("ignores malformed and unknown events", () => {
    expect(applyChatEvent(EMPTY_LIVE, { event: "token", data: { content: 1 } })).toBe(EMPTY_LIVE)
    expect(applyChatEvent(EMPTY_LIVE, { event: "approval_required", data: {} })).toBe(EMPTY_LIVE)
    expect(applyChatEvent(EMPTY_LIVE, { event: "ping", data: null })).toBe(EMPTY_LIVE)
  })
})

describe("memory folding status", () => {
  it("shows folding until the reply starts", () => {
    const folding = applyChatEvent(EMPTY_LIVE, { event: "memory_folding", data: {} })
    expect(folding.folding).toBe(true)
    expect(applyChatEvent(folding, { event: "token", data: { content: "Hi" } }).folding).toBe(false)
    expect(
      applyChatEvent(folding, { event: "tool_call", data: { id: "t1", tool: "fs_read", server: "builtin" } }).folding
    ).toBe(false)
  })
})

describe("applyUsageEvent", () => {
  it("prices each model call with the price from the context event", () => {
    let tracker: UsageTracker = { usage: EMPTY_SESSION_USAGE, price: null }
    tracker = applyUsageEvent(tracker, { event: "llm_response", data: { usage: { inputTokens: 100, outputTokens: 10 } } })
    expect(tracker.usage).toMatchObject({ calls: 1, pricedCalls: 0 })
    tracker = applyUsageEvent(tracker, {
      event: "context",
      data: { artifacts: [], price: { inputPerMTok: 1_000, outputPerMTok: 2_000, source: "openrouter" } },
    })
    tracker = applyUsageEvent(tracker, { event: "llm_response", data: { usage: { inputTokens: 100, outputTokens: 10 } } })
    expect(tracker.usage).toMatchObject({ calls: 2, pricedCalls: 1, inputTokens: 200, costUsd: 0.12 })
  })

  it("ignores events without usage and bad prices", () => {
    const start = { usage: EMPTY_SESSION_USAGE, price: null }
    expect(applyUsageEvent(start, { event: "llm_response", data: { turn: 1 } })).toBe(start)
    expect(applyUsageEvent(start, { event: "token", data: { content: "x" } })).toBe(start)
    const bad = applyUsageEvent(start, { event: "context", data: { artifacts: [], price: { inputPerMTok: -1 } } })
    expect(bad.price).toBeNull()
  })
})
