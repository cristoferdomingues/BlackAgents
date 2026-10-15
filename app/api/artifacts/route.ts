import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { workspaceRoot } from "@/lib/fs-service"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { ArtifactStoreError, createArtifact } from "@/lib/artifacts/store"
import { artifactInputSchema } from "@/lib/artifacts/schemas"

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return ok([])
    const artifacts = await scanWorkspace(config.currentPath)
    return ok(artifacts)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = artifactInputSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid artifact")
    }
    const root = await workspaceRoot()
    try {
      return ok(await createArtifact(root, parsed.data), 201)
    } catch (err) {
      if (err instanceof ArtifactStoreError) return fail(err.message, err.status)
      throw err
    }
  })
}
