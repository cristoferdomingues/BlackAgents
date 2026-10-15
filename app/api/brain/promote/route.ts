import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { ProposalError, proposeConceptFromMemory } from "@/lib/brain/learn"
import { readConfig } from "@/lib/config"

const bodySchema = z.object({
  id: z.string().trim().min(1, "A concept id is required"),
  type: z.string().trim().min(1, "type is required"),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional(),
  content: z.string().trim().min(1, "The note is empty").max(20_000),
})

/** Queue a memory note as a knowledge concept. Nothing is written until approval. */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request")
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    try {
      const proposal = await proposeConceptFromMemory(currentPath, parsed.data)
      return ok({ proposalId: proposal.id, title: proposal.title, kind: proposal.kind }, 201)
    } catch (err) {
      if (err instanceof ProposalError) return fail(err.message, err.status)
      throw err
    }
  })
}
