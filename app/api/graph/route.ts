import { ok, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { buildGraph } from "@/lib/artifacts/graph"

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return ok({ nodes: [], links: [] })
    const artifacts = await scanWorkspace(config.currentPath)
    return ok(buildGraph(artifacts))
  })
}
