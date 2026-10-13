import path from "path"
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
  type McpServerConfig,
  type McpServerConfigInput,
} from "./types"

/**
 * Cursor treats a URL with no transport as HTTP POST.
 * `transport: "http"` is omitted so the file is not read as SSE.
 * SSE stays marked, because a bare URL would otherwise use HTTP.
 */
function forCursorMcpFile(server: McpServerConfig): McpServerConfig {
  if (server.transport !== "http") return server
  const next = { ...server }
  delete next.transport
  return next
}

function getMcpConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".cursor", "mcp.json")
}

export async function readWorkspaceMcpConfig(
  workspaceRoot: string
): Promise<McpConfig> {
  const abs = getMcpConfigPath(workspaceRoot)
  if (!(await pathExists(abs))) {
    return { mcpServers: {} }
  }
  const raw = await readText(abs)
  if (!raw) {
    return { mcpServers: {} }
  }
  try {
    const json = JSON.parse(raw)
    const parsed = mcpConfigSchema.safeParse(json)
    if (parsed.success) {
      return parsed.data
    }
    return { mcpServers: {} }
  } catch {
    return { mcpServers: {} }
  }
}

export async function writeWorkspaceMcpConfig(
  workspaceRoot: string,
  config: McpConfig
): Promise<void> {
  const abs = getMcpConfigPath(workspaceRoot)
  const onDisk: McpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(config.mcpServers).map(([name, server]) => [
        name,
        forCursorMcpFile(server),
      ])
    ),
  }
  await writeText(abs, JSON.stringify(onDisk, null, 2) + "\n")
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
