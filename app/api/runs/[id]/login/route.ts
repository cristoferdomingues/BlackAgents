import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { setBrowserSecrets } from "@/lib/secrets"
import { resolveLogin } from "@/lib/workflows/login-wait"
import { readRun } from "@/lib/workflows/store"

const bodySchema = z
  .object({
    username: z.string().trim().min(1).max(200).optional(),
    password: z.string().min(1).max(500).optional(),
    alreadyLoggedIn: z.boolean().optional(),
  })
  .refine((body) => body.alreadyLoggedIn === true || (Boolean(body.username) && Boolean(body.password)), {
    message: "Enter a username and password, or confirm that you already signed in.",
  })

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Save a step login and resume that same step. */
export async function POST(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid login", 400)

    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const run = await readRun(currentPath, id)
    if (!run) return fail("Run not found", 404)
    const pending = run.pendingLogin
    if (!pending || run.status !== "waiting_login") {
      return fail("This run is not waiting for a login", 409)
    }

    if (parsed.data.alreadyLoggedIn) {
      if (!resolveLogin(pending.id, { action: "already" })) {
        return fail("This login wait already ended", 409)
      }
      return ok({ continued: true })
    }

    await setBrowserSecrets({
      [pending.usernameSecret]: parsed.data.username ?? "",
      [pending.passwordSecret]: parsed.data.password ?? "",
    })
    if (!resolveLogin(pending.id, { action: "save" })) {
      return fail("This login wait already ended", 409)
    }
    return ok({ continued: true })
  })
}
