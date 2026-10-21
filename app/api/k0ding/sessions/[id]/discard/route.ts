import { handle } from "@/lib/api-response"
import { discardChanges, statusAfter } from "@/lib/k0ding/changes"
import { K0dingError } from "@/lib/k0ding/errors"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { pathsBodySchema, sessionView } from "@/lib/k0ding/schema"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { readCodingSession, saveCodingSession } from "@/lib/k0ding/sessions"
import { requireCodeRoot } from "@/lib/k0ding/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const parsed = pathsBodySchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Pick at least one file")
      const { workspace, scope } = await k0dingWorkspace()
      const current = await readCodingSession(workspace, scope, (await ctx.params).id)
      if (!current) throw new K0dingError("Coding session not found", 404)
      await requireCodeRoot(workspace, scope, current.rootId)
      const changes = discardChanges(current.changes, parsed.data.paths)
      const saved = await saveCodingSession(workspace, scope, {
        ...current,
        changes,
        status: statusAfter(changes),
      })
      return sessionView(saved)
    })
  )
}
