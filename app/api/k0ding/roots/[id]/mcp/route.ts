import { handle } from "@/lib/api-response"
import { detectMcpCandidate, tryAndSaveMcpServer } from "@/lib/k0ding/mcp-helper"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { requireCodeRoot } from "@/lib/k0ding/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export const maxDuration = 60

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      return detectMcpCandidate(workspace, root)
    })
  )
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      return tryAndSaveMcpServer(workspace, root, await req.json().catch(() => null))
    })
  )
}
