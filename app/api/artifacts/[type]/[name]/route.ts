import { ok, fail, handle } from "@/lib/api-response"
import {
  pathExists,
  removePath,
  resolveInWorkspace,
  workspaceRoot,
  writeText,
} from "@/lib/fs-service"
import { findArtifact } from "@/lib/artifacts/parser"
import { serializeArtifact } from "@/lib/artifacts/serializer"
import { artifactInputSchema, artifactTypeSchema } from "@/lib/artifacts/schemas"

interface RouteContext {
  params: Promise<{ type: string; name: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
    const parsedType = artifactTypeSchema.safeParse(type)
    if (!parsedType.success) return fail(`Unknown artifact type: ${type}`, 404)

    const root = await workspaceRoot()
    const artifact = await findArtifact(root, parsedType.data, name)
    if (!artifact) return fail(`Not found: ${type}/${name}`, 404)
    return ok(artifact)
  })
}

export async function PUT(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
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
    const existing = await findArtifact(root, parsedType.data, name)
    if (!existing) return fail(`Not found: ${type}/${name}`, 404)

    // Honor the platform of the existing artifact when rewriting.
    const { relPath, content } = serializeArtifact({
      ...input,
      platform: existing.platform,
    })
    const targetAbs = resolveInWorkspace(root, relPath)

    const renamed = input.name !== name
    if (renamed && (await pathExists(targetAbs))) {
      return fail(`A ${input.type} named "${input.name}" already exists`, 409)
    }

    await writeText(targetAbs, content)

    if (renamed) {
      // Remove the old file/dir after writing the new one.
      const oldPath =
        existing.type === "skill"
          ? existing.relativePath.replace(/\/SKILL\.md$/, "")
          : existing.relativePath
      await removePath(resolveInWorkspace(root, oldPath))
    }

    const updated = await findArtifact(root, parsedType.data, input.name)
    return ok(updated)
  })
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { type, name } = await ctx.params
    const parsedType = artifactTypeSchema.safeParse(type)
    if (!parsedType.success) return fail(`Unknown artifact type: ${type}`, 404)

    const root = await workspaceRoot()
    const existing = await findArtifact(root, parsedType.data, name)
    if (!existing) return fail(`Not found: ${type}/${name}`, 404)

    const deletePath =
      existing.type === "skill"
        ? existing.relativePath.replace(/\/SKILL\.md$/, "")
        : existing.relativePath
    await removePath(resolveInWorkspace(root, deletePath))
    return ok({ deleted: true })
  })
}
