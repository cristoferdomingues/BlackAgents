import { ok, fail, handle } from "@/lib/api-response"
import { ProposalError, proposeMemoryNote } from "@/lib/brain/learn"
import { readConfig } from "@/lib/config"
import { memoryDraftSchema } from "@/lib/llm/memory-draft"

/**
 * Send a memory draft to the Brain inbox. This route never writes a memory
 * note; human approval performs that write.
 */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const parsed = memoryDraftSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)

    try {
      const proposal = await proposeMemoryNote(currentPath, parsed.data)
      return ok({ proposalId: proposal.id, title: proposal.title, agent: proposal.agent ?? null }, 201)
    } catch (err) {
      if (err instanceof ProposalError) return fail(err.message, err.status)
      throw err
    }
  })
}
