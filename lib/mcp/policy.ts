import { z } from "zod"

import { pathExists, readText, resolveInWorkspace, writeText } from "@/lib/fs-service"

/**
 * How much BlackAgents trusts each MCP server's tools. Kept in our own file
 * (`.black-agents/mcp-policy.json`) so Cursor's `.cursor/mcp.json` stays
 * untouched and valid for Cursor.
 *
 * - `trusted` — calls run without asking (read risk).
 * - `ask`     — calls need approval unless writes are allowed (write risk).
 * - `risky`   — every call needs approval (exec risk).
 */
export const mcpTrustSchema = z.enum(["trusted", "ask", "risky"])
export type McpTrust = z.infer<typeof mcpTrustSchema>

export const DEFAULT_MCP_TRUST: McpTrust = "ask"

export const mcpPolicySchema = z.object({
  servers: z.record(mcpTrustSchema).default({}),
})
export type McpPolicy = z.infer<typeof mcpPolicySchema>

export const MCP_POLICY_PATH = ".black-agents/mcp-policy.json"

export async function readMcpPolicy(workspaceRoot: string): Promise<McpPolicy> {
  const abs = resolveInWorkspace(workspaceRoot, MCP_POLICY_PATH)
  if (!(await pathExists(abs))) return { servers: {} }
  try {
    const parsed = mcpPolicySchema.safeParse(JSON.parse(await readText(abs)) as unknown)
    return parsed.success ? parsed.data : { servers: {} }
  } catch {
    return { servers: {} }
  }
}

export async function setMcpServerTrust(
  workspaceRoot: string,
  server: string,
  trust: McpTrust
): Promise<McpPolicy> {
  const policy = await readMcpPolicy(workspaceRoot)
  policy.servers[server] = trust
  await writeText(
    resolveInWorkspace(workspaceRoot, MCP_POLICY_PATH),
    `${JSON.stringify(policy, null, 2)}\n`
  )
  return policy
}

export function trustOf(policy: McpPolicy, server: string): McpTrust {
  return policy.servers[server] ?? DEFAULT_MCP_TRUST
}
