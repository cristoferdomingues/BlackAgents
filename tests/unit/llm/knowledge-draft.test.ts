import { describe, expect, it } from "vitest"

import {
  extractKnowledgeDraft,
  inspectKnowledgeDraft,
  stripKnowledgeBlock,
} from "@/lib/llm/knowledge-draft"

const draft = {
  id: "architecture/agent-loop",
  type: "Design Decision",
  title: "Agent loop",
  description: "How the bounded agent loop works.",
  body: "# Agent loop\n\nThe loop stops after a fixed number of turns.",
  tags: ["runtime"],
  sources: [{ resource: "https://example.com/runtime", title: "Runtime docs" }],
}

function fenced(value: unknown): string {
  return `Here is the note.\n\n\`\`\`knowledge\n${JSON.stringify(value)}\n\`\`\`\n\nReview it.`
}

describe("knowledge draft protocol", () => {
  it("reads a valid knowledge draft", () => {
    expect(extractKnowledgeDraft(fenced(draft))).toEqual(draft)
    expect(inspectKnowledgeDraft(fenced(draft))).toEqual({ kind: "ok", draft })
  })

  it("rejects a bad id and a missing type with a named field", () => {
    expect(inspectKnowledgeDraft(fenced({ ...draft, id: "Bad Id" }))).toMatchObject({
      kind: "invalid",
      message: expect.stringContaining('"id"'),
    })
    const { type, ...withoutType } = draft
    void type
    expect(inspectKnowledgeDraft(fenced(withoutType))).toMatchObject({
      kind: "invalid",
      message: expect.stringContaining('"type"'),
    })
  })

  it("explains a cut-off block", () => {
    expect(inspectKnowledgeDraft('```knowledge\n{"id":"architecture/agent-loop"')).toEqual({
      kind: "invalid",
      message: "The knowledge draft was cut off before the end.",
    })
  })

  it("removes the block from visible prose", () => {
    expect(stripKnowledgeBlock(fenced(draft))).toBe("Here is the note.\n\n\n\nReview it.")
    expect(stripKnowledgeBlock(" plain reply ")).toBe("plain reply")
  })
})
