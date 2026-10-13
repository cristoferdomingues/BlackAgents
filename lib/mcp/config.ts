import {
  pathExists,
  readText,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"
import {
  mcpConfigSchema,
  mcpServerConfigSchema,
  type McpConfig,
  type McpServerConfigInput,
} from "./types"

/** BlackAgents-owned MCP server list for the active workspace. */
export const MCP_CONFIG_REL_PATH = ".black-agents/mcp.json"

/** Legacy path used before MCP config moved under `.black-agents/`. */
export const LEGACY_CURSOR_MCP_REL_PATH = ".cursor/mcp.json"

function parseMcpConfig(raw: string): McpConfig | null {
  if (!raw.trim()) return null
  try {
    const parsed = mcpConfigSchema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function readMcpFile(
  workspaceRoot: string,
  relativePath: string
): Promise<McpConfig | null> {
  const abs = resolveInWorkspace(workspaceRoot, relativePath)
  if (!(await pathExists(abs))) return null
  const raw = await readText(abs)
  if (!raw) return null
  return parseMcpConfig(raw)
}

/**
 * Read MCP servers for the workspace.
 * Prefers `.black-agents/mcp.json`. If missing, migrates a legacy
 * `.cursor/mcp.json` once into the BlackAgents path.
 */
export async function readWorkspaceMcpConfig(
  workspaceRoot: string
): Promise<McpConfig> {
  const owned = await readMcpFile(workspaceRoot, MCP_CONFIG_REL_PATH)
  if (owned) return owned

  const legacy = await readMcpFile(workspaceRoot, LEGACY_CURSOR_MCP_REL_PATH)
  if (legacy && Object.keys(legacy.mcpServers).length > 0) {
    await writeWorkspaceMcpConfig(workspaceRoot, legacy)
    return legacy
  }

  return { mcpServers: {} }
}

/** Persist MCP servers to `.black-agents/mcp.json`. */
export async function writeWorkspaceMcpConfig(
  workspaceRoot: string,
  config: McpConfig
): Promise<void> {
  const abs = resolveInWorkspace(workspaceRoot, MCP_CONFIG_REL_PATH)
  await writeText(abs, JSON.stringify(config, null, 2) + "\n")
}

export async function saveWorkspaceMcpServer(
  workspaceRoot: string,
  name: string,
  serverConfig: McpServerConfigInput
): Promise<McpConfig> {
  const current = await readWorkspaceMcpConfig(workspaceRoot)
  current.mcpServers[name] = mcpServerConfigSchema.parse(serverConfig)
  await writeWorkspaceMcpConfig(workspaceRoot, current)
  return current
}

export async function deleteWorkspaceMcpServer(
  workspaceRoot: string,
  name: string
): Promise<McpConfig> {
  const current = await readWorkspaceMcpConfig(workspaceRoot)
  delete current.mcpServers[name]
  await writeWorkspaceMcpConfig(workspaceRoot, current)
  return current
}
