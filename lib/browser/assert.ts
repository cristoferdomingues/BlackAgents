import { BROWSER_MCP_SERVER } from "./constants"
import type { BrowserFlowExpect, BrowserFlowStep } from "./flows/schema"

export interface SnapshotExecutor {
  (
    server: string,
    tool: string,
    args: Record<string, unknown>
  ): Promise<{ result?: unknown; error?: string }>
}

function snapshotText(result: unknown): string {
  if (typeof result === "string") return result
  if (result == null) return ""
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

/** Preferred Playwright MCP snapshot tool names (tried in order). */
export const SNAPSHOT_TOOLS = ["browser_snapshot", "browser_take_screenshot"] as const

/**
 * Take a page snapshot via MCP and evaluate an expect clause.
 */
export async function runAssertStep(
  step: BrowserFlowStep,
  execute: SnapshotExecutor
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const expect = step.expect
  if (!expect) {
    return { ok: false, error: "Assert step is missing an expect clause" }
  }

  let lastError = "No snapshot tool available"
  let text = ""

  for (const tool of SNAPSHOT_TOOLS) {
    const trace = await execute(BROWSER_MCP_SERVER, tool, {})
    if (trace.error) {
      lastError = trace.error
      continue
    }
    text = snapshotText(trace.result)
    break
  }

  if (!text && lastError) {
    return { ok: false, error: `Could not snapshot page: ${lastError}` }
  }

  return evaluateExpect(expect, text)
}

export function evaluateExpect(
  expect: BrowserFlowExpect,
  pageText: string
): { ok: true; text: string } | { ok: false; error: string } {
  if (expect.type === "text_includes") {
    if (!pageText.toLowerCase().includes(expect.value.toLowerCase())) {
      return {
        ok: false,
        error: `Expected page text to include "${expect.value}"`,
      }
    }
  }
  return { ok: true, text: pageText }
}
