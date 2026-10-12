import { describe, expect, it } from "vitest"

import {
  extractWorkflowDraft,
  parseStoredWorkflowDraft,
  stripWorkflowBlock,
} from "@/lib/llm/workflow-draft"

const valid = {
  name: "release-line",
  description: "Plan then review a release.",
  steps: [
    { id: "plan", agent: "planner", instructions: "Plan it" },
    { id: "review", agent: "reviewer" },
  ],
}

function reply(json: unknown): string {
  return `Here is a workflow.\n\n\`\`\`workflow\n${JSON.stringify(json, null, 2)}\n\`\`\`\n`
}

describe("extractWorkflowDraft", () => {
  it("parses a valid block and applies schema defaults", () => {
    const draft = extractWorkflowDraft(reply(valid))
    expect(draft?.name).toBe("release-line")
    expect(draft?.trigger).toEqual({ type: "manual" })
    expect(draft?.steps[1].input).toBe("previous")
  })

  it("returns null without a block, for bad JSON, or for an invalid workflow", () => {
    expect(extractWorkflowDraft("No workflow here")).toBeNull()
    expect(extractWorkflowDraft("```workflow\n{not json}\n```")).toBeNull()
    expect(extractWorkflowDraft(reply({ ...valid, steps: [] }))).toBeNull()
    expect(extractWorkflowDraft(reply({ ...valid, name: "Bad Name" }))).toBeNull()
    expect(
      extractWorkflowDraft(
        reply({ ...valid, steps: [valid.steps[0], { id: "plan", agent: "reviewer" }] })
      )
    ).toBeNull()
  })

  it("strips the block from the prose", () => {
    expect(stripWorkflowBlock(reply(valid))).toBe("Here is a workflow.")
  })
})

describe("parseStoredWorkflowDraft", () => {
  it("validates storage content again", () => {
    expect(parseStoredWorkflowDraft(JSON.stringify(valid))?.name).toBe("release-line")
    expect(parseStoredWorkflowDraft(null)).toBeNull()
    expect(parseStoredWorkflowDraft("{oops")).toBeNull()
    expect(parseStoredWorkflowDraft(JSON.stringify({ name: "x" }))).toBeNull()
  })
})
