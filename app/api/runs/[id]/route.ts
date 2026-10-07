import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { getRunner } from "@/lib/workflows/runner"
import { isTerminal } from "@/lib/workflows/schema"
import { readRun } from "@/lib/workflows/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const run = await readRun(currentPath, id)
    if (!run) return fail("Run not found", 404)
    return ok({ run })
  })
}

/** Cancel a queued or running run. */
export async function DELETE(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const run = await readRun(currentPath, id)
    if (!run) return fail("Run not found", 404)
    if (isTerminal(run.status)) return fail("This run has already finished", 409)
    if (!(await getRunner().cancel(id))) return fail("This run is not active", 409)
    return ok({ id, cancelled: true })
  })
}
