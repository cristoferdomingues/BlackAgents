import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { normalizeShellProgram } from "@/lib/runtime/tools/shell-risk"
import { readWorkspaceTrust, setShellCommandsTrust } from "@/lib/runtime/trust"

const putSchema = z.object({
  shellCommands: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  trusted: z.boolean(),
})

/** Shell approval trust for the active workspace (`~/.black-agents/approval-trust.json`). */
export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return ok({ shellCommands: [] })
    return ok(await readWorkspaceTrust(config.currentPath))
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const parsed = putSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    const programs = parsed.data.shellCommands
      .map(normalizeShellProgram)
      .filter((program): program is string => Boolean(program))
    if (programs.length === 0) return fail("No valid program name was given")
    const config = await readConfig()
    if (!config.currentPath) return fail("No workspace selected", 412)
    return ok(await setShellCommandsTrust(config.currentPath, programs, parsed.data.trusted))
  })
}
