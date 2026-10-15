import { ok, fail, handle } from "@/lib/api-response"
import { workspaceRoot } from "@/lib/fs-service"
import { findArtifact } from "@/lib/artifacts/parser"
import { ArtifactStoreError, deleteArtifact, updateArtifact } from "@/lib/artifacts/store"
import { artifactInputSchema, artifactTypeSchema } from "@/lib/artifacts/schemas"

interface RouteContext {
  params: Promise<{ type: string; name: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
    const decodedName = decodeURIComponent(name)
    const parsedType = artifactTypeSchema.safeParse(type)
    if (!parsedType.success) return fail(`Unknown artifact type: ${type}`, 404)

    const root = await workspaceRoot()
    const artifact = await findArtifact(root, parsedType.data, decodedName)
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
    try {
      return ok(await updateArtifact(root, decodedName, input))
    } catch (err) {
      if (err instanceof ArtifactStoreError) return fail(err.message, err.status)
      throw err
    }
  })
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
    const decodedName = decodeURIComponent(name)
    const parsedType = artifactTypeSchema.safeParse(type)
    if (!parsedType.success) return fail(`Unknown artifact type: ${type}`, 404)

    const root = await workspaceRoot()
    try {
      await deleteArtifact(root, parsedType.data, decodedName)
    } catch (err) {
      if (err instanceof ArtifactStoreError) return fail(err.message, err.status)
      throw err
    }
    return ok({ deleted: true })
  })
}
