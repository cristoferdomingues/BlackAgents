import { ok, fail, handle } from "@/lib/api-response"
import { workspaceRoot } from "@/lib/fs-service"
import { findArtifact } from "@/lib/artifacts/parser"
import { resolveScopeParam } from "@/lib/artifacts/scope-request"
import { ArtifactStoreError, deleteArtifact, updateArtifact } from "@/lib/artifacts/store"
import { artifactInputSchema, artifactTypeSchema } from "@/lib/artifacts/schemas"

interface RouteContext {
  params: Promise<{ type: string; name: string }>
}

/**
 * `?scope=<project-id>` resolves the artifact scope-first (project copy wins,
 * inherited copies are visible but read-only: PUT/DELETE only touch
 * project-local files).
 */
export async function GET(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
    const decodedName = decodeURIComponent(name)
    const parsedType = artifactTypeSchema.safeParse(type)
    if (!parsedType.success) return fail(`Unknown artifact type: ${type}`, 404)

    const root = await workspaceRoot()
    const scope = await resolveScopeParam(root, req.url)
    if (!scope.ok) return fail(scope.error, scope.status)
    const artifact = await findArtifact(root, parsedType.data, decodedName, scope.scope)
    if (!artifact) return fail(`Not found: ${type}/${name}`, 404)
    return ok(artifact)
  })
}

export async function PUT(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
    const decodedName = decodeURIComponent(name)
    const parsedType = artifactTypeSchema.safeParse(type)
    if (!parsedType.success) return fail(`Unknown artifact type: ${type}`, 404)

    const json = await req.json().catch(() => null)
    const parsed = artifactInputSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid artifact")
    }
    const input = parsed.data
    if (input.type !== parsedType.data) {
      return fail("Artifact type cannot be changed", 400)
    }

    const root = await workspaceRoot()
    const scope = await resolveScopeParam(root, req.url)
    if (!scope.ok) return fail(scope.error, scope.status)
    try {
      return ok(await updateArtifact(root, decodedName, input, scope.scope))
    } catch (err) {
      if (err instanceof ArtifactStoreError) return fail(err.message, err.status)
      throw err
    }
  })
}

export async function DELETE(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
    const decodedName = decodeURIComponent(name)
    const parsedType = artifactTypeSchema.safeParse(type)
    if (!parsedType.success) return fail(`Unknown artifact type: ${type}`, 404)

    const root = await workspaceRoot()
    const scope = await resolveScopeParam(root, req.url)
    if (!scope.ok) return fail(scope.error, scope.status)
    try {
      await deleteArtifact(root, parsedType.data, decodedName, scope.scope)
    } catch (err) {
      if (err instanceof ArtifactStoreError) return fail(err.message, err.status)
      throw err
    }
    return ok({ deleted: true })
  })
}
