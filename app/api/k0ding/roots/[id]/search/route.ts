import { handle } from "@/lib/api-response"
import { K0dingError } from "@/lib/k0ding/errors"
import { searchCode } from "@/lib/k0ding/listing"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { searchQuerySchema } from "@/lib/k0ding/schema"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { requireCodeRoot } from "@/lib/k0ding/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      const params = new URL(req.url).searchParams
      const query = searchQuerySchema.safeParse({
        q: params.get("q") ?? "",
        ...(params.get("dir") ? { dir: params.get("dir") } : {}),
      })
      if (!query.success) throw new K0dingError(query.error.issues[0]?.message ?? "Type something to search")
      return searchCode(root, query.data.q, query.data.dir ?? "")
    })
  )
}
