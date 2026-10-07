import { ok, fail, handle } from "@/lib/api-response"
import { decideProposal, ProposalError } from "@/lib/brain/learn"
import { proposalDecisionSchema } from "@/lib/brain/types"
import { readConfig } from "@/lib/config"

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Approve (apply, optionally edited) or reject one proposal. */
export async function POST(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const parsed = proposalDecisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision")
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    try {
      return ok({ proposal: await decideProposal(currentPath, id, parsed.data) })
    } catch (err) {
      if (err instanceof ProposalError) return fail(err.message, err.status)
      throw err
    }
  })
}
