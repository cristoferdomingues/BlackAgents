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
  type McpServerConfigInput,
} from "./types"

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
