import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { workspaceRoot } from "@/lib/fs-service"
import {
  ProjectError,
  createProject,
  listProjectsDetailed,
} from "@/lib/artifacts/projects"
import { projectInputSchema } from "@/lib/artifacts/schemas"

/**
 * GET  /api/projects — list valid projects, broken folders (fail-closed
 *                        rejections) and the active project id.
 * POST /api/projects — create a project scope: `.black-agents/projects/<id>/`
 *                        with a `project.json` manifest (createdAt is
 *                        server-owned). Returns 409 on a duplicate id.
 */

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return ok({ projects: [], invalid: [], activeProject: null })
    }
    const { projects, invalid } = await listProjectsDetailed(config.currentPath)
    return ok({ projects, invalid, activeProject: config.activeProject ?? null })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = projectInputSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid project", 400)
    }
    const root = await workspaceRoot()
    try {
      const project = await createProject(root, {
        ...parsed.data,
        createdAt: new Date().toISOString(),
      })
      return ok(project, 201)
    } catch (err) {
      if (err instanceof ProjectError) return fail(err.message, err.status)
      throw err
    }
  })
}
