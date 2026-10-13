import { describe, expect, it } from "vitest"

import { extractHealedStep, HEAL_FENCE } from "@/lib/browser/heal"

describe("extractHealedStep", () => {
  it("parses a fenced heal block", () => {
    const text = [
      "Here is the fix:",
      "```" + HEAL_FENCE,
      JSON.stringify({
        tool: "browser_click",
        args: { element: "Submit", ref: "e9" },
      }),
      "```",
    ].join("\n")
    expect(extractHealedStep(text)).toEqual({
      tool: "browser_click",
      args: { element: "Submit", ref: "e9" },
    })
  })

  it("returns null for invalid JSON", () => {
    expect(extractHealedStep("```browser_heal\nnot-json\n```")).toBeNull()
  })
})
