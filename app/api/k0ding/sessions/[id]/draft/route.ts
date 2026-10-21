import { handle } from "@/lib/api-response"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { buildK0dingDraft } from "@/lib/k0ding/draft"
import { K0dingError } from "@/lib/k0ding/errors"
import { k0dingOk } from "@/lib/k0ding/route-result"
import { k0dingDraftRequestSchema } from "@/lib/k0ding/schema"
import { k0dingWorkspace } from "@/lib/k0ding/scope"
import { readCodingSession } from "@/lib/k0ding/sessions"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  return handle(() =>
    k0dingOk(async () => {
      const parsed = k0dingDraftRequestSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Invalid draft request")
      const { workspace, scope } = await k0dingWorkspace()
      const session = await readCodingSession(workspace, scope, (await ctx.params).id)
      if (!session) throw new K0dingError("Coding session not found", 404)
      if (parsed.data.kind === "workflow") {
        const agent = parsed.data.agent
        const artifacts = await scanWorkspace(workspace, scope)
        if (!artifacts.some((artifact) => artifact.type === "agent" && artifact.name === agent)) {
          throw new K0dingError("Choose an existing agent")
        }
      }
      return buildK0dingDraft(session, parsed.data)
    })
  )
}
