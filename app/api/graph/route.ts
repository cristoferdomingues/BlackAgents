import { ok, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { buildGraph } from "@/lib/artifacts/graph"
import { listConcepts } from "@/lib/knowledge/store"

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return ok({ nodes: [], links: [] })
    const [artifacts, concepts] = await Promise.all([
      scanWorkspace(config.currentPath),
      listConcepts(config.currentPath).catch(() => []),
    ])
    return ok(
      buildGraph(
        artifacts,
        concepts.map((concept) => ({
          id: concept.id,
          title: concept.frontmatter.title,
          body: concept.body,
        }))
      )
    )
  })
}
