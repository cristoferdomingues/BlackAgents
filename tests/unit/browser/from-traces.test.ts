import { describe, expect, it } from "vitest"

import {
  flowStepsFromTraces,
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
    expect(steps[1].tool).toBe("browser_click")
    expect(startUrlFromSteps(steps)).toBe("https://example.com/timesheet")
  })
})
