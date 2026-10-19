import { ok, fail, handle } from "@/lib/api-response"
import { workspaceRoot } from "@/lib/fs-service"
import {
  ProjectError,
  deleteProject,
  loadProjectScope,
  saveProjectManifest,
} from "@/lib/artifacts/projects"
import { projectManifestSchema, projectUpdateSchema } from "@/lib/artifacts/schemas"

/**
 * GET    /api/projects/[id] — one project scope (404 when it does not load).
 * PATCH  /api/projects/[id] — update name / description / inherits. The id is
 *                               the folder name and never changes.
 * DELETE /api/projects/[id] — remove the project folder.
 */

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const root = await workspaceRoot()
    const loaded = await loadProjectScope(root, decodeURIComponent(id))
    if (!loaded.ok) return fail(`Project "${id}" is not available: ${loaded.error}`, 404)
    return ok(loaded.project)
  })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const projectId = decodeURIComponent(id)
    const json = await req.json().catch(() => null)
    const parsed = projectUpdateSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid project update", 400)
    }

    const root = await workspaceRoot()
    const loaded = await loadProjectScope(root, projectId)
    if (!loaded.ok) return fail(`Project "${id}" is not available: ${loaded.error}`, 404)

    const merged = projectManifestSchema.safeParse({
      id: loaded.project.id,
      name: parsed.data.name ?? loaded.project.name,
      description: parsed.data.description ?? loaded.project.description,
      inherits: parsed.data.inherits ?? loaded.project.inherits,
      createdAt: loaded.project.createdAt,
    })
    if (!merged.success) {
      return fail(merged.error.issues[0]?.message ?? "Invalid project update", 400)
    }

    try {
      return ok(await saveProjectManifest(root, merged.data))
    } catch (err) {
      if (err instanceof ProjectError) return fail(err.message, err.status)
      throw err
    }
  })
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const root = await workspaceRoot()
    const deleted = await deleteProject(root, decodeURIComponent(id))
    if (!deleted) return fail(`Project "${id}" is not available`, 404)
    return ok({ deleted: true })
  })
}
