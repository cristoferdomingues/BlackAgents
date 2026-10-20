import { ok, fail, handle } from "@/lib/api-response"
import { nameSchema } from "@/lib/artifacts/schemas"
import { resolveScopeParam } from "@/lib/artifacts/scope-request"
import { readConfig } from "@/lib/config"
import { getRunner } from "@/lib/workflows/runner"
import { parseWorkflowBody } from "@/lib/workflows/service"
import { deleteWorkflow, readWorkflow, saveWorkflow, workflowIsLocal } from "@/lib/workflows/store"

interface RouteContext {
  params: Promise<{ name: string }>
}

async function target(
  req: Request,
  ctx: RouteContext
): Promise<{ root: string; name: string; scope?: string } | Response> {
  const { name } = await ctx.params
  if (!nameSchema.safeParse(name).success) return fail("Invalid workflow name")
  const { currentPath } = await readConfig()
  if (!currentPath) return fail("No workspace selected", 412)
  const scope = await resolveScopeParam(currentPath, req.url)
  if (!scope.ok) return fail(scope.error, scope.status)
  return { root: currentPath, name, scope: scope.scope }
}

export async function GET(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const t = await target(req, ctx)
    if (t instanceof Response) return t
    const workflow = await readWorkflow(t.root, t.name, t.scope)
    if (!workflow) return fail("Workflow not found", 404)
    return ok({ workflow, active: getRunner().isActive(t.root, t.name, t.scope) })
  })
}

export async function PUT(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const t = await target(req, ctx)
    if (t instanceof Response) return t
    if (!(await readWorkflow(t.root, t.name, t.scope))) return fail("Workflow not found", 404)
    if (!(await workflowIsLocal(t.root, t.name, t.scope))) {
      return fail(`Inherited workflow "${t.name}" is read-only in this project — create a project copy to change it`, 403)
    }
    const parsed = await parseWorkflowBody(t.root, await req.json().catch(() => null), t.scope)
    if (!parsed.ok) return fail(parsed.message)
    if (parsed.workflow.name !== t.name) return fail("Renaming a workflow is not supported")
    await saveWorkflow(t.root, parsed.workflow, t.scope)
    return ok({ workflow: parsed.workflow })
  })
}

export async function DELETE(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const t = await target(req, ctx)
    if (t instanceof Response) return t
    if (getRunner().isActive(t.root, t.name, t.scope)) return fail("Cancel the active run first", 409)
    if (!(await workflowIsLocal(t.root, t.name, t.scope))) {
      if (await readWorkflow(t.root, t.name, t.scope)) {
        return fail(`Inherited workflow "${t.name}" cannot be deleted from this project`, 403)
      }
      return fail("Workflow not found", 404)
    }
    if (!(await deleteWorkflow(t.root, t.name, t.scope))) return fail("Workflow not found", 404)
    return ok({ deleted: t.name })
  })
}
