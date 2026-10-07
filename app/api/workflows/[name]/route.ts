import { ok, fail, handle } from "@/lib/api-response"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"
import { getRunner } from "@/lib/workflows/runner"
import { parseWorkflowBody } from "@/lib/workflows/service"
import { deleteWorkflow, readWorkflow, saveWorkflow } from "@/lib/workflows/store"

interface RouteContext {
  params: Promise<{ name: string }>
}

async function target(ctx: RouteContext): Promise<{ root: string; name: string } | Response> {
  const { name } = await ctx.params
  if (!nameSchema.safeParse(name).success) return fail("Invalid workflow name")
  const { currentPath } = await readConfig()
  if (!currentPath) return fail("No workspace selected", 412)
  return { root: currentPath, name }
}

export async function GET(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const t = await target(ctx)
    if (t instanceof Response) return t
    const workflow = await readWorkflow(t.root, t.name)
    if (!workflow) return fail("Workflow not found", 404)
    return ok({ workflow, active: getRunner().isActive(t.root, t.name) })
  })
}

export async function PUT(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const t = await target(ctx)
    if (t instanceof Response) return t
    if (!(await readWorkflow(t.root, t.name))) return fail("Workflow not found", 404)
    const parsed = await parseWorkflowBody(t.root, await req.json().catch(() => null))
    if (!parsed.ok) return fail(parsed.message)
    if (parsed.workflow.name !== t.name) return fail("Renaming a workflow is not supported")
    await saveWorkflow(t.root, parsed.workflow)
    return ok({ workflow: parsed.workflow })
  })
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const t = await target(ctx)
    if (t instanceof Response) return t
    if (getRunner().isActive(t.root, t.name)) return fail("Cancel the active run first", 409)
    if (!(await deleteWorkflow(t.root, t.name))) return fail("Workflow not found", 404)
    return ok({ deleted: t.name })
  })
}
