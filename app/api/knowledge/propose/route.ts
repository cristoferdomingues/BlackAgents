import { ok, fail, handle } from "@/lib/api-response"
import { ProposalError, proposeConcept } from "@/lib/brain/learn"
import { readConfig } from "@/lib/config"
import { knowledgeDraftSchema } from "@/lib/llm/knowledge-draft"

/**
 * Send a model-produced knowledge draft to the Brain inbox. This route never
 * writes a knowledge file; human approval performs that write.
 */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const parsed = knowledgeDraftSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)

    try {
      const proposal = await proposeConcept(
        currentPath,
        {
          id: parsed.data.id,
          type: parsed.data.type,
          title: parsed.data.title,
          description: parsed.data.description,
          content: parsed.data.body,
          tags: parsed.data.tags,
          sources: parsed.data.sources,
        },
        "assistant"
      )
      return ok({ proposalId: proposal.id, title: proposal.title, kind: proposal.kind }, 201)
    } catch (err) {
      if (err instanceof ProposalError) return fail(err.message, err.status)
      throw err
    }
  })
}
