import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import {
  deleteWorkspaceMcpServer,
  readWorkspaceMcpConfig,
  saveWorkspaceMcpServer,
} from "@/lib/mcp/config"
import { getWorkspaceServersStatus, testMcpServer } from "@/lib/mcp/client"
import {
  mcpSecretIdsForServer,
  promoteMcpSecrets,
} from "@/lib/mcp/promote-secrets"
import { readMcpPolicy, trustOf } from "@/lib/mcp/policy"
import { mcpServerConfigSchema } from "@/lib/mcp/types"
import { getMcpSecrets, removeMcpSecrets, setMcpSecrets } from "@/lib/secrets"

/**
 * List all configured MCP servers and their available tools for the active workspace.
 */
export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return ok({ servers: [], totalTools: 0 })
    }

    const [statuses, policy] = await Promise.all([
      getWorkspaceServersStatus(config.currentPath),
      readMcpPolicy(config.currentPath),
    ])
    const totalTools = statuses.reduce((sum, s) => sum + s.tools.length, 0)
    return ok({
      servers: statuses.map((s) => ({ ...s, trust: trustOf(policy, s.name) })),
      totalTools,
    })
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
  /** Header names whose values are stored in secrets.json (not mcp.json). */
  secretHeaders: z.array(z.string().trim().min(1)).optional(),
  /** Env keys whose values are stored in secrets.json (not mcp.json). */
  secretEnv: z.array(z.string().trim().min(1)).optional(),
})

/**
 * Add or update an MCP server configuration in .black-agents/mcp.json.
 * Optional secretHeaders / secretEnv move token values into ~/.black-agents/secrets.json.
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

    const { name, config: serverConfig, secretHeaders, secretEnv } = parsed.data

    if (!serverConfig.command && !serverConfig.url) {
      return fail("Either 'command' or 'url' must be specified for an MCP server")
    }

    const existingSecrets = await getMcpSecrets()
    const promoted = promoteMcpSecrets({
      serverName: name,
      config: serverConfig,
      secretHeaders,
      secretEnv,
      existingSecrets,
    })
    if (!promoted.ok) {
      return fail(promoted.error, 412)
    }

    if (Object.keys(promoted.upserts).length > 0) {
      await setMcpSecrets(promoted.upserts)
    }

    await saveWorkspaceMcpServer(config.currentPath, name, promoted.config)

    const status = await testMcpServer(name, promoted.config, config.currentPath)

    return ok({
      saved: true,
      server: status,
    })
  })
}

/**
 * Remove an MCP server configuration from .black-agents/mcp.json.
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

    const mcpSecrets = await getMcpSecrets()
    const toRemove = mcpSecretIdsForServer(name, Object.keys(mcpSecrets))
    if (toRemove.length > 0) {
      await removeMcpSecrets(toRemove)
    }

    return ok({ success: true, deleted: name })
  })
}
