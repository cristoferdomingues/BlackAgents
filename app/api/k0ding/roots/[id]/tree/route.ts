import { handle } from "@/lib/api-response"
import { listCodeTree } from "@/lib/k0ding/listing"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { treeQuerySchema } from "@/lib/k0ding/schema"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { requireCodeRoot } from "@/lib/k0ding/store"
import { K0dingError } from "@/lib/k0ding/errors"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      const query = treeQuerySchema.safeParse({
        dir: new URL(req.url).searchParams.get("dir") ?? "",
        hidden: new URL(req.url).searchParams.get("hidden") ?? "0",
      })
      if (!query.success) throw new K0dingError(query.error.issues[0]?.message ?? "Invalid query")
      return { entries: await listCodeTree(root, query.data.dir, query.data.hidden === "1") }
    })
  )
}
