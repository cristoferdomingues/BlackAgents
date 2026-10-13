import type { ToolExecutionTrace } from "@/lib/mcp/types"

import { BROWSER_MCP_SERVER } from "../constants"
import type { BrowserFlowStep } from "./schema"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Turn approved/successful browser MCP tool traces into flow steps.
 * Used by coach-mode "Save as flow" and by the live recorder.
 */
export function flowStepsFromTraces(
  traces: ToolExecutionTrace[],
  options?: { server?: string; includeErrors?: boolean }
): BrowserFlowStep[] {
  const server = options?.server ?? BROWSER_MCP_SERVER
  const includeErrors = options?.includeErrors ?? false
  const steps: BrowserFlowStep[] = []

  for (const trace of traces) {
    if (trace.server !== server) continue
    if (trace.error && !includeErrors) continue
    if (typeof trace.tool !== "string" || !trace.tool.trim()) continue
    const args = isRecord(trace.args) ? trace.args : {}
    steps.push({
      id: `step_${steps.length + 1}`,
      tool: trace.tool,
      args,
      note: trace.error ? `Prior error: ${trace.error}` : undefined,
    })
  }

  return steps
}

/** Extract a start URL from the first browser_navigate (or similar) step. */
export function startUrlFromSteps(steps: BrowserFlowStep[]): string | undefined {
  for (const step of steps) {
    if (step.tool === "browser_navigate" || step.tool.endsWith("_navigate")) {
      const url = step.args.url
      if (typeof url === "string" && /^https?:\/\//.test(url)) return url
    }
  }
  return undefined
}
