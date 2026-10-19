import { ok, fail, handle } from "@/lib/api-response"
import { readConfig, setActiveProject } from "@/lib/config"
import { workspaceRoot } from "@/lib/fs-service"
import { loadProjectScope } from "@/lib/artifacts/projects"
import { projectIdSchema } from "@/lib/artifacts/schemas"
import { z } from "zod"

/**
 * GET  /api/projects/active — the persisted active project id (next to the
 *                               active workspace in ~/.black-agents/config.json).
 * PUT  /api/projects/active — activate a project id, or clear it with
 *                               `{ "id": null }` (workspace mode). A project
 *                               must load (fail closed) before it can be
 *                               activated.
 */

const activeProjectInputSchema = z.object({
  id: z.union([projectIdSchema, z.null()]),
})

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    return ok({
      activeProject: config.activeProject ?? null,
      currentPath: config.currentPath ?? null,
    })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = activeProjectInputSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid active project", 400)
    }

    if (parsed.data.id === null) {
      const config = await setActiveProject(undefined)
      return ok({ activeProject: config.activeProject ?? null })
    }

    const root = await workspaceRoot()
    const loaded = await loadProjectScope(root, parsed.data.id)
    if (!loaded.ok) {
      return fail(`Project "${parsed.data.id}" is not available: ${loaded.error}`, 404)
    }
    const config = await setActiveProject(loaded.project.id)
    return ok({ activeProject: config.activeProject ?? null })
  })
}
