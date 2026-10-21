import { handle } from "@/lib/api-response"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { removeCodeRoot, updateCodeRoot } from "@/lib/k0ding/store"
import { K0dingError } from "@/lib/k0ding/errors"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      return updateCodeRoot(workspace, scope, (await ctx.params).id, await req.json().catch(() => null))
    })
  )
}

export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      const removed = await removeCodeRoot(workspace, scope, (await ctx.params).id)
      if (!removed) throw new K0dingError("Code folder not found", 404)
      return { removed: true }
    })
  )
}
