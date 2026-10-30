import { BROWSER_MCP_SERVER } from "@/lib/browser/constants"
import { isDesktopRuntime } from "@/lib/browser/platform"
import { executeWorkspaceTool, loadWorkspaceTools } from "@/lib/mcp/client"
import { readMcpPolicy, trustOf, type McpTrust } from "@/lib/mcp/policy"
import type { McpTool } from "@/lib/mcp/types"

import type { RuntimeTool, ToolRisk } from "../types"

/**
 * Risk of one MCP tool call. The workspace trust level sets the default, and
 * the server's own annotations refine it:
 *
 * - `destructiveHint` always asks, even for a trusted server.
 * - `readOnlyHint` runs directly under the default `ask` trust.
 *
 * Annotations are only hints from the server, so a `risky` server ignores them
 * and `destructiveHint` outranks every trust level.
 */
export function mcpRisk(tool: McpTool, trust: McpTrust): ToolRisk {
  if (tool.annotations?.destructiveHint) return "exec"
  if (trust === "trusted") return "read"
  if (trust === "risky") return "exec"
  if (tool.annotations?.readOnlyHint) return "read"
  return "write"
}

const MAX_TOOL_NAME = 64

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, "_")
}

/** Model-facing name: `server__tool`, safe for every provider. */
export function mcpToolName(server: string, tool: string): string {
  return `${sanitize(server)}__${sanitize(tool)}`.slice(0, MAX_TOOL_NAME)
}

export function toRuntimeTool(tool: McpTool, trust: McpTrust): RuntimeTool {
  return {
    name: mcpToolName(tool.server, tool.name),
    originalName: tool.name,
    server: tool.server,
    source: "mcp",
    risk: mcpRisk(tool, trust),
    description: `[MCP server: ${tool.server}] ${tool.description ?? ""}`.trim(),
    parameters: tool.inputSchema,
    summarize: (args) => `${tool.server} → ${tool.name}(${JSON.stringify(args).slice(0, 200)})`,
    async execute(args, ctx) {
      const trace = await executeWorkspaceTool(ctx.workspaceRoot, tool.server, tool.name, args)
      return { result: trace.result, error: trace.error }
    },
  }
}

/**
 * Connect to the workspace MCP servers (all, or only `servers`) and wrap their
 * tools with the risk level from the MCP trust policy and the tool's own
 * annotations. Failing servers are skipped so one broken server never blocks a
 * chat or a run.
 */
export async function loadMcpRuntimeTools(
  workspaceRoot: string,
  servers?: string[]
): Promise<RuntimeTool[]> {
  if (servers && servers.length === 0) return []
  try {
    const scoped =
      servers ??
      undefined
    const desktop = isDesktopRuntime()
    const [tools, policy] = await Promise.all([
      loadWorkspaceTools(workspaceRoot, scoped),
      readMcpPolicy(workspaceRoot),
    ])
    const seen = new Set<string>()
    const out: RuntimeTool[] = []
    for (const tool of tools) {
      if (tool.server === BROWSER_MCP_SERVER && !desktop) continue
      const runtime = toRuntimeTool(tool, trustOf(policy, tool.server))
      if (seen.has(runtime.name)) continue
      seen.add(runtime.name)
      out.push(runtime)
    }
    return out
  } catch {
    return []
  }
}
