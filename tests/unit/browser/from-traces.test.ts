import { describe, expect, it } from "vitest"

import {
  flowStepsFromTraces,
  intentFromToolArgs,
  looksLikeSecretFill,
  startUrlFromSteps,
} from "@/lib/browser/flows/from-traces"
import type { ToolExecutionTrace } from "@/lib/mcp/types"

describe("flowStepsFromTraces", () => {
  it("keeps successful browser MCP tools and skips others", () => {
    const traces: ToolExecutionTrace[] = [
      {
        id: "1",
        server: "browser",
        tool: "browser_navigate",
        args: { url: "https://example.com/timesheet" },
      },
      {
        id: "2",
        server: "browser",
        tool: "browser_click",
        args: { element: "Clock in" },
        error: "timeout",
      },
      {
        id: "3",
        server: "github",
        tool: "list_repos",
        args: {},
      },
      {
        id: "4",
        server: "browser",
        tool: "browser_click",
        args: { ref: "e12" },
      },
    ]

    const steps = flowStepsFromTraces(traces)
    expect(steps).toHaveLength(2)
    expect(steps[0].tool).toBe("browser_navigate")
    expect(steps[0].intent).toBe("Navigate to https://example.com/timesheet")
    expect(steps[0].kind).toBe("action")
    expect(steps[1].tool).toBe("browser_click")
    expect(steps[1].intent).toContain("ref")
    expect(startUrlFromSteps(steps)).toBe("https://example.com/timesheet")
  })
})

describe("intentFromToolArgs", () => {
  it("summarizes click and fill", () => {
    expect(intentFromToolArgs("browser_click", { element: "Submit" })).toBe(
      "Click Submit"
    )
    expect(intentFromToolArgs("browser_type", { element: "Email" })).toBe("Fill Email")
  })
})

describe("looksLikeSecretFill", () => {
  it("detects password fields", () => {
    expect(
      looksLikeSecretFill("browser_type", { element: "Password", text: "x" })
    ).toBe(true)
    expect(looksLikeSecretFill("browser_click", { element: "Password" })).toBe(false)
    expect(looksLikeSecretFill("browser_type", { element: "Email", text: "a" })).toBe(
      false
    )
  })
})
