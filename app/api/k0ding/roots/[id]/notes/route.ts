import { handle } from "@/lib/api-response"
import { readProjectNotes, saveProjectNotes } from "@/lib/k0ding/notes"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { requireCodeRoot } from "@/lib/k0ding/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      return { content: await readProjectNotes(workspace, scope, root.id) }
    })
  )
}

export async function PUT(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      const content = await saveProjectNotes(workspace, scope, root.id, await req.json().catch(() => null))
      return { content }
    })
  )
}
