import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { KnowledgePathError, assertConceptId, listConcepts, readConcept } from "@/lib/knowledge/store"
import { toKnowledgeConceptView, toKnowledgeListItem } from "@/lib/knowledge/view"

/** List saved concepts, or open one when `id` is set. */
export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const { currentPath } = await readConfig()
    const id = new URL(req.url).searchParams.get("id")
    if (!currentPath) {
      if (id) return fail("No workspace selected", 404)
      return ok({ concepts: [] })
    }
    const now = new Date()
    if (!id) {
      const concepts = await listConcepts(currentPath)
      return ok({ concepts: concepts.map((concept) => toKnowledgeListItem(concept, now)) })
    }
    if (!id.trim()) return fail("A concept id is required")
    try {
      assertConceptId(id)
    } catch (err) {
      if (err instanceof KnowledgePathError) return fail(err.message, 400)
      throw err
    }
    const concept = await readConcept(currentPath, id)
    if (!concept) return fail(`No concept "${id}"`, 404)
    return ok(toKnowledgeConceptView(concept, now))
  })
}
