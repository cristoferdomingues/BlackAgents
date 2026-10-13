import { describe, expect, it } from "vitest"

import {
  classifyBrowserFailure,
  formatStepFailure,
  looksLikeAuthFailure,
  looksLikeSelectorFailure,
} from "@/lib/browser/classify"

describe("classifyBrowserFailure", () => {
  it("detects auth and selector failures", () => {
    expect(looksLikeAuthFailure("Please sign in again")).toBe(true)
    expect(looksLikeSelectorFailure("Timeout: locator not found")).toBe(true)
    expect(classifyBrowserFailure("login required")).toBe("auth")
    expect(classifyBrowserFailure("element not found")).toBe("selector")
    expect(classifyBrowserFailure("boom", "assert")).toBe("assert")
  })

  it("formats step failures with index and intent", () => {
    const msg = formatStepFailure({
      flowName: "time-registration",
      stepIndex: 2,
      stepId: "step_3",
      intent: "Click Submit",
      tool: "browser_click",
      code: "selector",
      message: "timeout",
    })
    expect(msg).toContain("step 3")
    expect(msg).toContain('intent="Click Submit"')
    expect(msg).toContain("[selector]")
  })
})
