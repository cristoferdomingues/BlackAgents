import { handle } from "@/lib/api-response"
import { K0dingError } from "@/lib/k0ding/errors"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { commandResultSchema, runCommandSchema } from "@/lib/k0ding/schema"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { runCodeCommand } from "@/lib/k0ding/shell"
import { requireCodeRoot } from "@/lib/k0ding/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export const maxDuration = 120

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const parsed = runCommandSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Type a command")
      const { workspace, scope } = await k0dingWorkspace()
      const root = await requireCodeRoot(workspace, scope, (await ctx.params).id)
      const result = await runCodeCommand(root.path, parsed.data.command)
      return commandResultSchema.parse(result)
    })
  )
}
