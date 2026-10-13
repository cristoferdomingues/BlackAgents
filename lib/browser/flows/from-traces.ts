import type { ToolExecutionTrace } from "@/lib/mcp/types"

import { BROWSER_MCP_SERVER } from "../constants"
import type { BrowserFlowStep } from "./schema"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** Build a short intent string from a Playwright MCP tool + args. */
export function intentFromToolArgs(tool: string, args: Record<string, unknown>): string {
  const element = stringArg(args, "element")
  const ref = stringArg(args, "ref")
  const url = stringArg(args, "url")
  const text = stringArg(args, "text") ?? stringArg(args, "value")
  const short = tool.replace(/^browser_/, "").replace(/_/g, " ")

  if (tool.includes("navigate") && url) return `Navigate to ${url}`
  if (tool.includes("click") && element) return `Click ${element}`
  if (tool.includes("click") && ref) return `Click ref ${ref}`
  if ((tool.includes("type") || tool.includes("fill")) && element) {
    return `Fill ${element}`
  }
  if ((tool.includes("type") || tool.includes("fill")) && ref) {
    return `Fill ref ${ref}`
  }
  if (tool.includes("select") && element) return `Select in ${element}`
  if (text && text.length <= 80) return `${short}: ${text}`
  if (element) return `${short}: ${element}`
  if (ref) return `${short}: ${ref}`
  return short.charAt(0).toUpperCase() + short.slice(1)
}

/** True when a fill/type likely targets a password or secret field. */
export function looksLikeSecretFill(
  tool: string,
  args: Record<string, unknown>
): boolean {
  if (!tool.includes("type") && !tool.includes("fill")) return false
  const haystack = [
    stringArg(args, "element"),
    stringArg(args, "ref"),
    stringArg(args, "name"),
    stringArg(args, "label"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return (
    haystack.includes("password") ||
    haystack.includes("passwd") ||
    haystack.includes("secret") ||
    haystack.includes("api key") ||
    haystack.includes("token")
  )
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
    const args = isRecord(trace.args) ? { ...trace.args } : {}
    const intent = intentFromToolArgs(trace.tool, args)
    const step: BrowserFlowStep = {
      id: `step_${steps.length + 1}`,
      tool: trace.tool,
      args,
      intent,
      kind: "action",
      note: trace.error ? `Prior error: ${trace.error}` : undefined,
    }
    steps.push(step)
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
