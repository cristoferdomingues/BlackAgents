import {
  loadProjectScope,
  projectDirRelPath,
} from "@/lib/artifacts/projects"
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

/** A project's own MCP list: `.black-agents/projects/<id>/mcp.json`. */
export function projectMcpConfigRelPath(projectId: string): string {
  return `${projectDirRelPath(projectId)}/mcp.json`
}

/** MCP config path for a scope (project folder id, or the workspace). */
export function mcpConfigRelPath(scope?: string): string {
  return scope ? projectMcpConfigRelPath(scope) : MCP_CONFIG_REL_PATH
}

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

/** Persist MCP servers to a project's own `mcp.json`. The project must load. */
export async function writeProjectMcpConfig(
  workspaceRoot: string,
  projectId: string,
  config: McpConfig
): Promise<void> {
  const loaded = await loadProjectScope(workspaceRoot, projectId)
  if (!loaded.ok) throw new Error(loaded.error)
  const abs = resolveInWorkspace(workspaceRoot, projectMcpConfigRelPath(projectId))
  await writeText(abs, JSON.stringify(config, null, 2) + "\n")
}

export type McpServerOrigin = "workspace" | "project"

/** Merged MCP view for a scope, with per-server origins for the UI. */
export interface ScopedMcpView {
  config: McpConfig
  origins: Record<string, McpServerOrigin>
}

/**
 * Merge-order MCP resolution for a scope.
 *
 * - Workspace mode: the workspace config (with legacy migration).
 * - Project mode: the project `mcp.json` on top; when `mcp` is whitelisted in
 *   `project.json`, workspace servers fill in underneath — the project wins on
 *   name collision. Anything not whitelisted resolves to nothing (fail
 *   closed), and a project that fails to load sees no servers at all.
 */
export async function readScopedMcpConfig(
  workspaceRoot: string,
  scope?: string
): Promise<ScopedMcpView> {
  if (!scope) {
    const config = await readWorkspaceMcpConfig(workspaceRoot)
    const origins: Record<string, McpServerOrigin> = {}
    for (const name of Object.keys(config.mcpServers)) origins[name] = "workspace"
    return { config, origins }
  }

  const loaded = await loadProjectScope(workspaceRoot, scope)
  if (!loaded.ok) return { config: { mcpServers: {} }, origins: {} }

  const inheritWorkspace = loaded.project.inherits.includes("mcp")
  const base = inheritWorkspace
    ? await readWorkspaceMcpConfig(workspaceRoot)
    : { mcpServers: {} }
  const project = await readMcpFile(workspaceRoot, projectMcpConfigRelPath(scope))

  const config: McpConfig = { mcpServers: { ...base.mcpServers } }
  const origins: Record<string, McpServerOrigin> = {}
  for (const name of Object.keys(config.mcpServers)) origins[name] = "workspace"
  for (const [name, server] of Object.entries(project?.mcpServers ?? {})) {
    config.mcpServers[name] = server
    origins[name] = "project"
  }
  return { config, origins }
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

/** Save an MCP server into a scope: the project file when scoped, else workspace. */
export async function saveScopedMcpServer(
  workspaceRoot: string,
  name: string,
  serverConfig: McpServerConfigInput,
  scope?: string
): Promise<McpConfig> {
  const server = mcpServerConfigSchema.parse(serverConfig)
  const current = scope
    ? (await readMcpFile(workspaceRoot, projectMcpConfigRelPath(scope))) ?? {
        mcpServers: {},
      }
    : await readWorkspaceMcpConfig(workspaceRoot)
  current.mcpServers[name] = server
  if (scope) {
    await writeProjectMcpConfig(workspaceRoot, scope, current)
  } else {
    await writeWorkspaceMcpConfig(workspaceRoot, current)
  }
  return current
}

/** Delete an MCP server from a scope. Inherited servers are not deletable. */
export async function deleteScopedMcpServer(
  workspaceRoot: string,
  name: string,
  scope?: string
): Promise<McpConfig> {
  if (scope) {
    // A project may only delete its own servers; inherited ones live in the parent.
    const project = (await readMcpFile(workspaceRoot, projectMcpConfigRelPath(scope))) ?? {
      mcpServers: {},
    }
    delete project.mcpServers[name]
    await writeProjectMcpConfig(workspaceRoot, scope, project)
    const view = await readScopedMcpConfig(workspaceRoot, scope)
    return view.config
  }
  const current = await readWorkspaceMcpConfig(workspaceRoot)
  delete current.mcpServers[name]
  await writeWorkspaceMcpConfig(workspaceRoot, current)
  return current
}
