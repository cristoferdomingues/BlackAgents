import { describe, expect, it } from "vitest"

import { DECISION_KINDS, JEV_CUTOFF_LEVELS, summarizeDecisions, TUNABLE_DECISIONS } from "@/lib/decision/cutoffs"
import {
  choiceLabel,
  DECISION_HELP,
  DECISION_LABELS,
  emptyText,
  HIGH_STAKES,
  LEVEL_SUMMARIES,
  levelLabel,
  logLimitLine,
  OUTCOME_HELP,
  OUTCOME_LABELS,
  percent,
  PREFLIGHT_FIXED,
  scoreLine,
  summaryLine,
  wouldUseLine,
} from "@/lib/decision/explain"

describe("Jev decisions copy", () => {
  it("names every decision, level, and outcome", () => {
    for (const kind of DECISION_KINDS) expect(DECISION_LABELS[kind]).toBeTruthy()
    for (const kind of TUNABLE_DECISIONS) expect(DECISION_HELP[kind]).toBeTruthy()
    for (const level of JEV_CUTOFF_LEVELS) expect(LEVEL_SUMMARIES[level]).toBeTruthy()
    for (const outcome of ["acted", "below", "pass", "error"] as const) {
      expect(OUTCOME_LABELS[outcome]).toBeTruthy()
      expect(OUTCOME_HELP[outcome]).toBeTruthy()
    }
    expect(levelLabel("eager")).toBe("Eager · 70%")
    expect(percent(0.854)).toBe("85%")
    expect(PREFLIGHT_FIXED).toContain("95%")
  })

  it("keeps step checks and learning marked as high stakes", () => {
    expect(HIGH_STAKES.has("stepGate")).toBe(true)
    expect(HIGH_STAKES.has("learning")).toBe(true)
    expect(HIGH_STAKES.has("artifactRouting")).toBe(false)
  })

  it("teaches how the empty list fills", () => {
    expect(emptyText(false)).toContain("Turn on Use Jev")
    expect(emptyText(true)).not.toContain("Turn on")
  })

  it("summarizes counts and what a level would use", () => {
    const empty = summarizeDecisions([], "stepGate")
    expect(summaryLine(empty)).toBe("No decisions yet.")
    expect(wouldUseLine(empty, "eager")).toBeNull()
    const base = { at: "2026-10-21T10:00:00.000Z", kind: "stepGate", cutoff: 0.85, provider: "direct" } as const
    const summary = summarizeDecisions(
      [
        { ...base, choice: "stop", score: 0.8, outcome: "below" },
        { ...base, choice: "error", score: null, outcome: "error" },
      ],
      "stepGate"
    )
    expect(summaryLine(summary)).toBe("Last 2: 0 used, 1 below level, 0 no change, 1 failed.")
    expect(wouldUseLine(summary, "eager")).toBe("Would use 1 of 1")
  })

  it("labels answers and the size limit", () => {
    expect(choiceLabel({ kind: "artifactRouting", choice: "none" })).toBe("Nothing")
    expect(choiceLabel({ kind: "learning", choice: "nothing" })).toBe("Nothing")
    expect(choiceLabel({ kind: "stepGate", choice: "error" })).toBe("—")
    expect(choiceLabel({ kind: "stepGate", choice: "retry" })).toBe("retry")
    expect(scoreLine({ score: 0.8, cutoff: 0.85 })).toBe("80% / 85%")
    expect(scoreLine({ score: null, cutoff: 0.95 })).toBe("— / 95%")
    expect(logLimitLine(3, 200)).toBe("3 of 200 kept. The oldest drop off first.")
  })
})
