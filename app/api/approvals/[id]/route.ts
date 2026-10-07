import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { getPendingApproval, resolveApproval } from "@/lib/runtime/approvals"

const decisionSchema = z.object({
  approved: z.boolean(),
  remember: z.boolean().optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Approve or deny one pending tool call. */
export async function POST(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const parsed = decisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision")
    const pending = getPendingApproval(id)
    if (!pending) return fail("This approval is no longer pending", 404)
    const remember = parsed.data.approved && pending.risk === "exec" && Boolean(parsed.data.remember)
    resolveApproval(id, { approved: parsed.data.approved, remember })
    return ok({ id, approved: parsed.data.approved, remember })
  })
}
