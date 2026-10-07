import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { mcpTrustSchema, readMcpPolicy, setMcpServerTrust } from "@/lib/mcp/policy"

const putSchema = z.object({
  server: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Invalid server name"),
  trust: mcpTrustSchema,
})

/** MCP trust policy for the active workspace (`.black-agents/mcp-policy.json`). */
export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return ok({ servers: {} })
    return ok(await readMcpPolicy(config.currentPath))
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const parsed = putSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    const config = await readConfig()
    if (!config.currentPath) return fail("No workspace selected", 412)
    return ok(await setMcpServerTrust(config.currentPath, parsed.data.server, parsed.data.trust))
  })
}
