import { executeWorkspaceTool, loadWorkspaceTools } from "@/lib/mcp/client"
import { readMcpPolicy, trustOf, type McpTrust } from "@/lib/mcp/policy"
import type { McpTool } from "@/lib/mcp/types"

import type { RuntimeTool, ToolRisk } from "../types"

const TRUST_RISK: Record<McpTrust, ToolRisk> = {
  trusted: "read",
  ask: "write",
  risky: "exec",
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
    risk: TRUST_RISK[trust],
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
 * tools with the risk level from the MCP trust policy. Failing servers are
 * skipped so one broken server never blocks a chat or a run.
 */
export async function loadMcpRuntimeTools(
  workspaceRoot: string,
  servers?: string[]
): Promise<RuntimeTool[]> {
  if (servers && servers.length === 0) return []
  try {
    const [tools, policy] = await Promise.all([
      loadWorkspaceTools(workspaceRoot, servers),
      readMcpPolicy(workspaceRoot),
    ])
    const seen = new Set<string>()
    const out: RuntimeTool[] = []
    for (const tool of tools) {
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
