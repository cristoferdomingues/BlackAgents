import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { workspaceRoot } from "@/lib/fs-service"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { resolveScopeParam } from "@/lib/artifacts/scope-request"
import { ArtifactStoreError, createArtifact } from "@/lib/artifacts/store"
import { artifactInputSchema } from "@/lib/artifacts/schemas"

/**
 * `?scope=<project-id>` runs the route inside a project scope: reads are
 * scope-first and whitelist-gated; writes land in the project's own source
 * tree (never in the workspace source or IDE folders).
 */
export async function GET(req?: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return ok([])
    const scope = await resolveScopeParam(
      config.currentPath,
      req?.url ?? "http://localhost/api/artifacts"
    )
    if (!scope.ok) return fail(scope.error, scope.status)
    const artifacts = await scanWorkspace(config.currentPath, scope.scope)
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
    const scope = await resolveScopeParam(root, req.url)
    if (!scope.ok) return fail(scope.error, scope.status)
    try {
      return ok(await createArtifact(root, parsed.data, scope.scope), 201)
    } catch (err) {
      if (err instanceof ArtifactStoreError) return fail(err.message, err.status)
      throw err
    }
  })
}
