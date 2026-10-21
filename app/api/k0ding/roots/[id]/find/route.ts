import { handle } from "@/lib/api-response"
import { K0dingError } from "@/lib/k0ding/errors"
import { findCodeFiles } from "@/lib/k0ding/listing"
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
      const query = searchQuerySchema.safeParse({ q: new URL(req.url).searchParams.get("q") ?? "" })
      if (!query.success) throw new K0dingError(query.error.issues[0]?.message ?? "Type a file name")
      return findCodeFiles(root, query.data.q)
    })
  )
}
