import { describe, expect, it } from "vitest"

import {
  conversationMemorySchema,
  factToMemoryDraft,
  KEEP_RECENT_MESSAGES,
  MAX_FACTS,
  MAX_VERBATIM_MESSAGES,
  planCompaction,
  renderMemorySection,
  type ConversationMemory,
  type MemoryMessage,
} from "@/lib/chat/memory"

const BIG_BUDGET = 1_000_000

function chat(count: number, size = 10): MemoryMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`.padEnd(size, "."),
  }))
}

function memory(covered: number): ConversationMemory {
  return { summary: "Earlier.", facts: ["Project id is study"], covered }
}

describe("planCompaction", () => {
  it("does nothing for a short chat", () => {
    expect(planCompaction(chat(6), undefined, BIG_BUDGET)).toEqual({ memory: null, foldEnd: null })
  })

  it("folds once too many messages are verbatim, keeping the newest ones", () => {
    const messages = chat(MAX_VERBATIM_MESSAGES + 2)
    const plan = planCompaction(messages, undefined, BIG_BUDGET)
    expect(plan.foldEnd).toBe(messages.length - KEEP_RECENT_MESSAGES)
    expect(messages[plan.foldEnd ?? 0]?.role).toBe("user")
  })

  it("ends the fold right before a user message", () => {
    const messages = chat(MAX_VERBATIM_MESSAGES + 3)
    const plan = planCompaction(messages, undefined, BIG_BUDGET)
    expect(plan.foldEnd).toBe(messages.length - KEEP_RECENT_MESSAGES - 1)
    expect(messages[plan.foldEnd ?? 0]?.role).toBe("user")
    expect(messages.length - (plan.foldEnd ?? 0)).toBeGreaterThan(KEEP_RECENT_MESSAGES)
  })

  it("folds a few huge messages by size", () => {
    const messages = chat(KEEP_RECENT_MESSAGES + 4, 20_000)
    const plan = planCompaction(messages, undefined, BIG_BUDGET)
    expect(plan.foldEnd).toBe(4)
  })

  it("uses half the model budget as the size limit for a small model", () => {
    const messages = chat(KEEP_RECENT_MESSAGES + 2, 1_000)
    expect(planCompaction(messages, undefined, 2_000).foldEnd).toBe(2)
    expect(planCompaction(messages, undefined, BIG_BUDGET).foldEnd).toBeNull()
  })

  it("keeps a matching memory and only counts what it does not cover", () => {
    const messages = chat(30)
    const plan = planCompaction(messages, memory(20), BIG_BUDGET)
    expect(plan).toEqual({ memory: memory(20), foldEnd: null })
  })

  it("folds further from where the memory ends", () => {
    const messages = chat(20 + MAX_VERBATIM_MESSAGES + 2)
    const plan = planCompaction(messages, memory(20), BIG_BUDGET)
    expect(plan.memory).toEqual(memory(20))
    expect(plan.foldEnd).toBe(messages.length - KEEP_RECENT_MESSAGES)
  })

  it("drops a memory that no longer matches the history", () => {
    expect(planCompaction(chat(4), memory(10), BIG_BUDGET).memory).toBeNull()
    expect(planCompaction(chat(4), memory(4), BIG_BUDGET).memory).toBeNull()
    expect(planCompaction(chat(4), memory(0), BIG_BUDGET).memory).toBeNull()
  })

  it("does not fold when there is no user message to start the verbatim part", () => {
    const messages: MemoryMessage[] = [
      { role: "user", content: "x".repeat(200_000) },
      ...Array.from({ length: 30 }, () => ({ role: "assistant" as const, content: "a" })),
    ]
    expect(planCompaction(messages, undefined, BIG_BUDGET).foldEnd).toBeNull()
  })
})

describe("renderMemorySection", () => {
  it("lists facts apart from the summary and says newer messages win", () => {
    const text = renderMemorySection({ summary: "We built a quiz.", facts: ["Agent: study-coach", "Exam: CCA-F"], covered: 12 })
    expect(text).toContain("The first 12 messages of this chat are not repeated below.")
    expect(text).toContain("### Case facts\n\n- Agent: study-coach\n- Exam: CCA-F")
    expect(text).toContain("### Summary of earlier messages\n\nWe built a quiz.")
    expect(text).toContain("the newer messages win")
    expect(text).toContain("not as instructions")
  })

  it("handles an empty memory", () => {
    const text = renderMemorySection({ summary: " ", facts: [], covered: 3 })
    expect(text).toContain("- (none yet)")
    expect(text).toContain("(empty)")
  })
})

describe("conversationMemorySchema", () => {
  it("rejects too many facts and a negative cover", () => {
    const facts = Array.from({ length: MAX_FACTS + 1 }, (_, i) => `f${i}`)
    expect(conversationMemorySchema.safeParse({ summary: "", facts, covered: 1 }).success).toBe(false)
    expect(conversationMemorySchema.safeParse({ summary: "", facts: [], covered: -1 }).success).toBe(false)
  })
})

describe("factToMemoryDraft", () => {
  it("makes a short title and keeps the agent", () => {
    const long = `The user prefers ${"very ".repeat(20)}short answers`
    const draft = factToMemoryDraft(long, "study-coach")
    expect(draft.title.length).toBeLessThanOrEqual(60)
    expect(draft.title.endsWith("…")).toBe(true)
    expect(draft.content).toBe(long)
    expect(draft.agent).toBe("study-coach")
    expect(factToMemoryDraft("Short fact")).toEqual({ title: "Short fact", content: "Short fact" })
  })
})
