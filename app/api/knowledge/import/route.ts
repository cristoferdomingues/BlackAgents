import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { workspaceRoot } from "@/lib/fs-service"
import { KnowledgeImportError, previewBundle, queueConcept } from "@/lib/knowledge/import"

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), path: z.string().trim().min(1, "A folder path is required") }),
  z.object({
    action: z.literal("queue"),
    path: z.string().trim().min(1, "A folder path is required"),
    id: z.string().trim().min(1, "A concept id is required"),
  }),
])

/**
 * Preview is read-only. Queue adds an inbox proposal and still does not write
 * the knowledge file; approval does that.
 */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request")
    const root = await workspaceRoot()
    try {
      if (parsed.data.action === "preview") return ok(await previewBundle(parsed.data.path))
      const proposal = await queueConcept(root, parsed.data.path, parsed.data.id)
      return ok({ proposalId: proposal.id, title: proposal.title }, 201)
    } catch (err) {
      if (err instanceof KnowledgeImportError) return fail(err.message, err.status)
      throw err
    }
  })
}
