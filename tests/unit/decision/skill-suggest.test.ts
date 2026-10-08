import { describe, expect, it, vi } from "vitest"

import type { TypeSafeClient } from "@typesafe-ai/sdk"

import type { ResolvedDecisionClient } from "@/lib/decision/client"
import {
  defaultPositivePrompts,
  descriptionHasTrigger,
  evaluateSkillTriggers,
  GENERIC_NEGATIVE_PROMPTS,
  skillTriggerSummary,
  suggestSkill,
} from "@/lib/decision/skill-suggest"

import { choiceAnswer, fakeJev } from "../../helpers/jev"

const review = {
  name: "code-review",
  description: "Reviews a pull request. Use when the user asks for a code review.",
}

describe("skill trigger text", () => {
  it("finds a trigger phrase and builds short prompts from the description", () => {
    expect(descriptionHasTrigger(review.description)).toBe(true)
    expect(descriptionHasTrigger("Reviews a pull request.")).toBe(false)
    expect(defaultPositivePrompts(review.description)).toEqual([
      "Reviews a pull request.",
      "the user asks for a code review.",
    ])
    expect(defaultPositivePrompts("Hi")).toEqual(["Hi"])
  })

  it("names the problem from the probe counts", () => {
    const counts = {
      passed: 0,
      total: 2,
      truePositives: 0,
      trueNegatives: 0,
      falsePositives: 1,
      falseNegatives: 1,
    }
    expect(skillTriggerSummary({ warning: null, counts }).verdict).toBe("unclear")
    expect(skillTriggerSummary({ warning: null, counts: { ...counts, falseNegatives: 0 } }).verdict).toBe(
      "too-broad"
    )
    expect(skillTriggerSummary({ warning: null, counts: { ...counts, falsePositives: 0 } }).verdict).toBe(
      "never-triggers"
    )
    expect(
      skillTriggerSummary({
        warning: "Add “Use when …” so Jev knows when to open this skill.",
        counts: { ...counts, falsePositives: 0, falseNegatives: 0, passed: 2 },
      }).verdict
    ).toBe("ready")
  })
})

describe("suggestSkill", () => {
  it("returns empty or unavailable before calling Jev", async () => {
    expect(await suggestSkill({ prompt: "review", skills: [], resolved: fakeJev({}) })).toEqual({
      kind: "empty",
    })
    expect(await suggestSkill({ prompt: "review", skills: [review], resolved: null })).toEqual({
      kind: "unavailable",
    })
  })

  it("picks a skill, ignores a weak or empty choice, and reports Jev errors", async () => {
    const picked = await suggestSkill({
      prompt: "please review this pull request",
      skills: [review, { name: "notes", description: "Use when the user wants meeting notes." }],
      resolved: fakeJev({ skill: choiceAnswer("S0", 0.91) }),
    })
    expect(picked).toMatchObject({ kind: "picked", name: "code-review", confidence: 0.91, candidates: 2 })

    expect(
      await suggestSkill({
        prompt: "hello",
        skills: [review],
        resolved: fakeJev({ skill: choiceAnswer("NONE", 0.4) }),
      })
    ).toMatchObject({ kind: "none" })

    expect(
      await suggestSkill({
        prompt: "hello",
        skills: [review],
        resolved: fakeJev({ skill: choiceAnswer("S0", 0.5) }),
      })
    ).toMatchObject({ kind: "none" })

    expect(
      await suggestSkill({
        prompt: "hello",
        skills: [review],
        resolved: fakeJev(new Error("timeout")),
      })
    ).toEqual({ kind: "error", message: "timeout" })
  })
})

describe("evaluateSkillTriggers", () => {
  function clientFor(pick: (prompt: string) => string): ResolvedDecisionClient {
    const systemOne = vi.fn(async (input: { state: { prompt: string } }) => ({
      model: "jev-test",
      answers: { skill: choiceAnswer(pick(input.state.prompt), 0.92) },
      usage: { input_tokens: 1, output_tokens: 1 },
    }))
    return { provider: "direct", client: { systemOne } as unknown as TypeSafeClient }
  }

  it("passes when the skill opens only for its own job", async () => {
    const result = await evaluateSkillTriggers({
      skill: review,
      catalog: [{ name: "notes", description: "Use when the user wants meeting notes." }],
      resolved: clientFor((prompt) => (prompt.toLowerCase().includes("review") ? "S0" : "NONE")),
    })
    expect(result.kind).toBe("report")
    if (result.kind !== "report") return
    expect(result.report.verdict).toBe("ready")
    expect(result.report.warning).toBeNull()
    expect(result.report.counts.falsePositives).toBe(0)
    expect(result.report.counts.falseNegatives).toBe(0)
    expect(result.report.probes.some((probe) => probe.prompt === GENERIC_NEGATIVE_PROMPTS[0])).toBe(true)
  })

  it("flags a description that opens for unrelated tasks", async () => {
    const result = await evaluateSkillTriggers({
      skill: { name: "code-review", description: "Helps with anything." },
      catalog: [],
      resolved: clientFor(() => "S0"),
    })
    expect(result.kind).toBe("report")
    if (result.kind !== "report") return
    expect(result.report.verdict).toBe("too-broad")
    expect(result.report.warning).toContain("Use when")
  })

  it("stops when Jev is off", async () => {
    expect(
      await evaluateSkillTriggers({ skill: review, catalog: [], resolved: null })
    ).toEqual({ kind: "unavailable" })
  })
})
