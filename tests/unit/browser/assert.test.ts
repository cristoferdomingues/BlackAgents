import { describe, expect, it } from "vitest"

import { evaluateExpect, runAssertStep } from "@/lib/browser/assert"
import type { BrowserFlowStep } from "@/lib/browser/flows/schema"

describe("evaluateExpect", () => {
  it("passes when text is included", () => {
    const result = evaluateExpect(
      { type: "text_includes", value: "Submitted" },
      "Status: Submitted for today"
    )
    expect(result.ok).toBe(true)
  })

  it("fails when text is missing", () => {
    const result = evaluateExpect(
      { type: "text_includes", value: "Submitted" },
      "Draft saved"
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("Submitted")
  })
})

describe("runAssertStep", () => {
  it("snapshots then checks expect", async () => {
    const step: BrowserFlowStep = {
      id: "a1",
      tool: "assert",
      args: {},
      kind: "assert",
      expect: { type: "text_includes", value: "OK" },
    }
    const result = await runAssertStep(step, async (_s, tool) => {
      if (tool === "browser_snapshot") return { result: "Page says OK" }
      return { error: "no" }
    })
    expect(result.ok).toBe(true)
  })
})
