import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import {
  deleteWorkspaceMcpServer,
  readWorkspaceMcpConfig,
  saveWorkspaceMcpServer,
} from "@/lib/mcp/config"
import { getWorkspaceServersStatus, testMcpServer } from "@/lib/mcp/client"
import { mcpServerConfigSchema } from "@/lib/mcp/types"

/**
 * List all configured MCP servers and their available tools for the active workspace.
 */
export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return ok({ servers: [], totalTools: 0 })
    }

    const statuses = await getWorkspaceServersStatus(config.currentPath)
    const totalTools = statuses.reduce((sum, s) => sum + s.tools.length, 0)
    return ok({ servers: statuses, totalTools })
  })
}

const postSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Server name is required")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Use alphanumeric characters, dashes, or underscores for server name"
    ),
  config: mcpServerConfigSchema,
})

/**
 * Add or update an MCP server configuration in .cursor/mcp.json.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return fail("No active workspace selected", 400)
    }

    const json = await req.json().catch(() => null)
    const parsed = postSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid MCP server config")
    }

    const { name, config: serverConfig } = parsed.data

    if (!serverConfig.command && !serverConfig.url) {
      return fail("Either 'command' or 'url' must be specified for an MCP server")
    }

    // Save to workspace .cursor/mcp.json
    await saveWorkspaceMcpServer(config.currentPath, name, serverConfig)

    // Test server status
    const status = await testMcpServer(name, serverConfig, config.currentPath)

    return ok({
      saved: true,
      server: status,
    })
  })
}

/**
 * Remove an MCP server configuration from .cursor/mcp.json.
 */
export async function DELETE(req: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return fail("No active workspace selected", 400)
    }

    const name = new URL(req.url).searchParams.get("name")
    if (!name?.trim()) {
      return fail("Server name is required")
    }

    const mcpConfig = await readWorkspaceMcpConfig(config.currentPath)
    if (!mcpConfig.mcpServers[name]) {
      return fail(`Server "${name}" not found in workspace config`, 404)
    }

    await deleteWorkspaceMcpServer(config.currentPath, name)
    return ok({ success: true, deleted: name })
  })
}
