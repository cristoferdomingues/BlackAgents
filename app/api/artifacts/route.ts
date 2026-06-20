import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import {
  pathExists,
  resolveInWorkspace,
  workspaceRoot,
  writeText,
} from "@/lib/fs-service"
import { findArtifact, scanWorkspace } from "@/lib/artifacts/parser"
import { serializeArtifact } from "@/lib/artifacts/serializer"
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
    const input = parsed.data
    const root = await workspaceRoot()

    const { relPath, content } = serializeArtifact(input)
    const abs = resolveInWorkspace(root, relPath)
    if (await pathExists(abs)) {
      return fail(`A ${input.type} named "${input.name}" already exists`, 409)
    }

    await writeText(abs, content)
    const created = await findArtifact(root, input.type, input.name)
    return ok(created, 201)
  })
}
