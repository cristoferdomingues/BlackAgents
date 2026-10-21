import { handle } from "@/lib/api-response"
import { K0dingError } from "@/lib/k0ding/errors"
import { readCodeFile } from "@/lib/k0ding/read-file"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { saveCodeFile } from "@/lib/k0ding/save-file"
import { pathQuerySchema, saveFileSchema } from "@/lib/k0ding/schema"
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
      const query = pathQuerySchema.safeParse({ path: new URL(req.url).searchParams.get("path") ?? "" })
      if (!query.success) throw new K0dingError(query.error.issues[0]?.message ?? "A file path is required")
      return readCodeFile(root.path, query.data.path)
    })
  )
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const parsed = saveFileSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Invalid file")
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      return saveCodeFile(root.path, parsed.data.path, parsed.data.content, parsed.data.hash)
    })
  )
}
