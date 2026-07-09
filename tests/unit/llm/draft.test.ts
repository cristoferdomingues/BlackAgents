import { describe, it, expect } from "vitest"

import {
  extractDraft,
  normalizeDraft,
  stripDraftBlock,
  type ArtifactDraft,
} from "@/lib/llm/draft"

const validDraft = {
  type: "agent",
  name: "pr-guardian",
  description: "Guards PRs.",
  body: "## Input\n- diff\n",
}

function fenced(obj: unknown): string {
  return "Here you go:\n\n```artifact\n" + JSON.stringify(obj) + "\n```\n\nDone."
}

describe("extractDraft", () => {
  it("extracts and normalizes a valid draft block", () => {
    const draft = extractDraft(fenced(validDraft))
    expect(draft).toMatchObject({
      type: "agent",
      name: "pr-guardian",
      description: "Guards PRs.",
      parallel: false,
      alwaysApply: false,
      globs: [],
    })
  })

  it("carries through optional flags", () => {
    const draft = extractDraft(
      fenced({ ...validDraft, type: "rule", parallel: true, alwaysApply: true, globs: ["a/**"] })
    )
    expect(draft).toMatchObject({ alwaysApply: true, parallel: true, globs: ["a/**"] })
  })

  it("returns null when there is no artifact fence", () => {
    expect(extractDraft("just prose, no block")).toBeNull()
  })

  it("returns null when the JSON is malformed", () => {
    expect(extractDraft("```artifact\n{ not json }\n```")).toBeNull()
  })

  it("returns null when the schema fails (missing body)", () => {
    const { body, ...noBody } = validDraft
    void body
    expect(extractDraft(fenced(noBody))).toBeNull()
  })

  it("returns null for a non-kebab name", () => {
    expect(extractDraft(fenced({ ...validDraft, name: "Bad Name" }))).toBeNull()
  })
})

describe("stripDraftBlock", () => {
  it("removes the artifact fence and trims the outer ends", () => {
    // The surrounding text is preserved; only the fenced block is removed and
    // the result is end-trimmed (interior blank lines remain).
    expect(stripDraftBlock(fenced(validDraft))).toBe("Here you go:\n\n\n\nDone.")
  })

  it("leaves text without a block unchanged (trimmed)", () => {
    expect(stripDraftBlock("  hello  ")).toBe("hello")
  })
})

describe("normalizeDraft", () => {
  it("applies defaults for optional fields", () => {
    const normalized = normalizeDraft(validDraft as ArtifactDraft)
    expect(normalized).toEqual({
      type: "agent",
      name: "pr-guardian",
      description: "Guards PRs.",
      body: "## Input\n- diff\n",
      parallel: false,
      alwaysApply: false,
      globs: [],
    })
  })
})
