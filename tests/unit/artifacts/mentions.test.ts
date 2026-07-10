import { describe, it, expect } from "vitest"

import {
  applyMentions,
  formatMention,
  hasMentionTokens,
  mentionToken,
} from "@/lib/artifacts/mentions"

describe("mentionToken", () => {
  it("encodes type and name so same-named artifacts never collide", () => {
    expect(mentionToken("agent", "review")).toBe("@agent:review")
    expect(mentionToken("skill", "review")).toBe("@skill:review")
  })
})

describe("formatMention", () => {
  it("uses bold for agents and commands", () => {
    expect(formatMention("agent", "tester")).toBe("**tester**")
    expect(formatMention("command", "ship")).toBe("**ship**")
  })

  it("uses the backtick + keyword form for rules and skills", () => {
    expect(formatMention("rule", "typescript-strict")).toBe("`typescript-strict` rule")
    expect(formatMention("skill", "testing-patterns")).toBe("`testing-patterns` skill")
  })
})

describe("applyMentions", () => {
  it("rewrites each token to its markdown convention", () => {
    const body =
      "Invoke the @agent:tester agent, read the @rule:typescript-strict, and consult @skill:testing-patterns."
    expect(applyMentions(body)).toBe(
      "Invoke the **tester** agent, read the `typescript-strict` rule, and consult `testing-patterns` skill."
    )
  })

  it("disambiguates same-named artifacts by their type", () => {
    expect(applyMentions("@agent:review vs @skill:review")).toBe(
      "**review** vs `review` skill"
    )
  })

  it("is idempotent on already-formatted text (no tokens)", () => {
    const formatted = "Read the `typescript-strict` rule and **tester**."
    expect(applyMentions(formatted)).toBe(formatted)
  })

  it("leaves stray @ characters untouched", () => {
    expect(applyMentions("email me @ home @notatoken")).toBe(
      "email me @ home @notatoken"
    )
  })

  it("produces references the graph extractor will detect", () => {
    // agent bold, rule + skill backtick+keyword — matches lib/artifacts/graph.ts
    expect(applyMentions("@rule:web3-security")).toMatch(/`web3-security` rule/)
  })
})

describe("hasMentionTokens", () => {
  it("detects unresolved tokens", () => {
    expect(hasMentionTokens("see @agent:tester")).toBe(true)
    expect(hasMentionTokens("see **tester**")).toBe(false)
  })

  it("is repeatable (global regex lastIndex is reset)", () => {
    const body = "@rule:a"
    expect(hasMentionTokens(body)).toBe(true)
    expect(hasMentionTokens(body)).toBe(true)
  })
})
