import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { testMcpServer } from "@/lib/mcp/client"
import { blankPlainHeaderError } from "@/lib/mcp/headers"
import { promoteMcpSecrets } from "@/lib/mcp/promote-secrets"
import {
  firstMissingMcpSecret,
  redactMcpServerStatus,
} from "@/lib/mcp/resolve-secrets"
import { mcpServerWriteSchema } from "@/lib/mcp/types"
import { getMcpSecrets } from "@/lib/secrets"

/**
 * Test an unsaved MCP server draft.
 * Promotes header/env secrets in memory, merges them with stored MCP secrets,
 * and connects. Does not write `.black-agents/mcp.json` or `secrets.json`.
 *
 * Edit mode: a `${secret:id}` placeholder, or a missing/blank replacement,
 * keeps the stored secret. The response config uses placeholders only.
 */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return fail("No active workspace selected", 400)
    }

    const json = await req.json().catch(() => null)
    const parsed = mcpServerWriteSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid MCP server config")
    }

    const { name, config: serverConfig, secretHeaders, secretEnv } = parsed.data

    if (!serverConfig.command && !serverConfig.url) {
      return fail("Either 'command' or 'url' must be specified for an MCP server")
    }

    const plainHeaderError = blankPlainHeaderError(serverConfig.headers, secretHeaders)
    if (plainHeaderError) return fail(plainHeaderError)

    const stored = await getMcpSecrets()
    const promoted = promoteMcpSecrets({
      serverName: name,
      config: serverConfig,
      secretHeaders,
      secretEnv,
      existingSecrets: stored,
    })
    if (!promoted.ok) return fail(promoted.error, 412)

    const merged = { ...stored, ...promoted.upserts }

    if (!promoted.config.disabled) {
      const missingId = firstMissingMcpSecret(promoted.config, merged)
      if (missingId) {
        return fail(
          `MCP secret "${missingId}" is not configured. Add it in Settings → MCP Servers.`,
          412
        )
      }
    }

    const status = await testMcpServer(
      name,
      promoted.config,
      config.currentPath,
      merged
    )

    return ok(redactMcpServerStatus(status, merged, promoted.upserts))
  })
}
