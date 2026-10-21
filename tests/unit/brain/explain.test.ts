import { describe, expect, it } from "vitest"

import {
  approveEffect,
  KIND_HELP,
  KIND_LABEL,
  LINKS_HELP,
  linksEffect,
  MEMORY_BUDGET_CHARS,
  memoryUsage,
  proposalOrigin,
  scopeLabel,
} from "@/lib/brain/explain"
import { LEARNING_ACTIONS, type BrainProposal } from "@/lib/brain/types"

function source(overrides: Partial<BrainProposal["source"]> = {}): BrainProposal["source"] {
  return { kind: "chat", signal: "feedback", ...overrides }
}

describe("related links copy", () => {
  it("says which other notes change", () => {
    expect(LINKS_HELP).toContain("link back")
    expect(linksEffect(0)).toBe("No other note will change.")
    expect(linksEffect(1)).toBe("1 other note gets a link back to this one.")
    expect(linksEffect(3)).toBe("3 other notes get a link back to this one.")
  })
})

describe("labels and help", () => {
  it("has a label and help text for every proposal kind", () => {
    for (const action of LEARNING_ACTIONS.filter((a) => a !== "nothing")) {
      expect(KIND_LABEL[action]).toBeTruthy()
      expect(KIND_HELP[action]).toBeTruthy()
    }
  })

  it("names the scope", () => {
    expect(scopeLabel(undefined)).toBe("All agents")
    expect(scopeLabel("coder")).toBe("Only coder")
  })
})

describe("approveEffect", () => {
  it("says whose memory a note goes to", () => {
    expect(approveEffect({ kind: "memory_note", agent: "coder" })).toBe(
      "Approve adds this note to the memory of the coder agent."
    )
    expect(approveEffect({ kind: "memory_note" })).toBe("Approve adds this note to the memory of every agent.")
  })

  it("names the skill or rule that changes", () => {
    expect(approveEffect({ kind: "update_skill", target: { type: "skill", name: "api" } })).toContain("rewrites the skill api")
    expect(approveEffect({ kind: "new_skill", target: { type: "skill", name: "api" } })).toContain("creates the skill api")
    expect(approveEffect({ kind: "update_rule", target: { type: "rule", name: "style" } })).toContain("rewrites the rule style")
    expect(approveEffect({ kind: "new_rule", target: { type: "rule", name: "style" } })).toContain("creates the rule style")
    expect(approveEffect({ kind: "new_concept", target: { type: "concept", name: "crypto/fees" } })).toContain(
      ".black-agents/knowledge/"
    )
    expect(approveEffect({ kind: "update_concept", target: { type: "concept", name: "crypto/fees" } })).toContain(
      "updates crypto/fees"
    )
  })

  it("falls back when the target is missing", () => {
    expect(approveEffect({ kind: "new_rule" })).toContain("the artifact")
  })
})

describe("proposalOrigin", () => {
  it("says a promoted note came from memory", () => {
    expect(proposalOrigin({ source: source({ kind: "memory" }), decision: { by: "feedback" } })).toBe(
      "From a memory note you chose to save as knowledge."
    )
  })

  it("says an imported concept came from a bundle", () => {
    expect(proposalOrigin({ source: source({ kind: "import" }), decision: { by: "feedback" } })).toBe(
      "From an OKF bundle you previewed."
    )
  })

  it("says meeting notes came from a meeting", () => {
    expect(proposalOrigin({ source: source({ kind: "meeting" }), decision: { by: "feedback" } })).toBe(
      "From a meeting. You chose to save these notes as knowledge."
    )
  })

  it("says a knowledge draft came from the Assistant", () => {
    expect(proposalOrigin({ source: source({ kind: "assistant" }), decision: { by: "feedback" } })).toBe(
      "From the Assistant. You asked to save it as knowledge."
    )
  })

  it("says a memory draft came from the Assistant", () => {
    expect(
      proposalOrigin({
        kind: "memory_note",
        source: source({ kind: "assistant" }),
        decision: { by: "feedback" },
      })
    ).toBe("From the Assistant. You asked to remember this.")
  })

  it("describes feedback from the Assistant", () => {
    expect(proposalOrigin({ source: source({ rating: "down" }), decision: { by: "feedback" } })).toBe(
      "From your thumbs down in the Assistant."
    )
    expect(proposalOrigin({ source: source({ rating: "up" }), decision: { by: "feedback" } })).toBe(
      "From your thumbs up in the Assistant."
    )
    expect(proposalOrigin({ source: source(), decision: { by: "feedback" } })).toBe(
      "From your feedback in the Assistant."
    )
  })

  it("describes workflow signals", () => {
    expect(proposalOrigin({ source: source({ kind: "run", signal: "self" }), decision: { by: "feedback" } })).toBe(
      "From a workflow self-check."
    )
    expect(proposalOrigin({ source: source({ kind: "run" }), decision: { by: "feedback" } })).toBe(
      "From your feedback on a workflow run."
    )
  })

  it("adds Jev's confidence as a percent", () => {
    expect(proposalOrigin({ source: source(), decision: { by: "jev", confidence: 0.876 } })).toBe(
      "From your feedback in the Assistant. Jev picked it (88% sure)."
    )
    expect(proposalOrigin({ source: source(), decision: { by: "jev" } })).toContain("(0% sure)")
  })
})

describe("memoryUsage", () => {
  it("counts characters against the chat budget", () => {
    expect(memoryUsage([])).toEqual({ chars: 0, fits: true })
    expect(memoryUsage(["abc", "de"])).toEqual({ chars: 5, fits: true })
    expect(memoryUsage(["x".repeat(MEMORY_BUDGET_CHARS)]).fits).toBe(true)
    expect(memoryUsage(["x".repeat(MEMORY_BUDGET_CHARS + 1)]).fits).toBe(false)
  })
})
