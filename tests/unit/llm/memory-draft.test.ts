import { describe, expect, it } from "vitest"

import { extractMemoryDraft, inspectMemoryDraft, stripMemoryBlock } from "@/lib/llm/memory-draft"

const draft = {
  title: "How to address the user",
  content: "Call the user Mr. Bombastic.",
}

function fenced(value: unknown): string {
  return `I can remember that.\n\n\`\`\`memory\n${JSON.stringify(value)}\n\`\`\`\n\nSend it if you want.`
}

describe("memory draft protocol", () => {
  it("reads a valid memory draft", () => {
    expect(extractMemoryDraft(fenced(draft))).toEqual(draft)
    expect(inspectMemoryDraft(fenced(draft))).toEqual({ kind: "ok", draft })
  })

  it("keeps an optional agent scope", () => {
    const scoped = { ...draft, agent: "coder" }
    expect(extractMemoryDraft(fenced(scoped))).toEqual(scoped)
  })

  it("rejects a missing sentence and a bad agent name", () => {
    const { content, ...withoutContent } = draft
    void content
    expect(inspectMemoryDraft(fenced(withoutContent))).toMatchObject({
      kind: "invalid",
      message: expect.stringContaining('"content"'),
    })
    expect(inspectMemoryDraft(fenced({ ...draft, agent: "Bad Name" }))).toMatchObject({
      kind: "invalid",
      message: expect.stringContaining('"agent"'),
    })
  })

  it("explains a cut-off block", () => {
    expect(inspectMemoryDraft('```memory\n{"title":"Name"')).toEqual({
      kind: "invalid",
      message: "The memory draft was cut off before the end.",
    })
  })

  it("removes the block from visible prose", () => {
    expect(stripMemoryBlock(fenced(draft))).toBe("I can remember that.\n\n\n\nSend it if you want.")
    expect(stripMemoryBlock(" plain reply ")).toBe("plain reply")
  })
})
