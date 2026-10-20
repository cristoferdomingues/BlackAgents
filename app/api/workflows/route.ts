import { ok, fail, handle } from "@/lib/api-response"
import { resolveScopeParam } from "@/lib/artifacts/scope-request"
import { readConfig } from "@/lib/config"
import { listWorkflowItems, parseWorkflowBody } from "@/lib/workflows/service"
import { saveWorkflow, workflowExists } from "@/lib/workflows/store"

/** Workflows of the active workspace or `?scope=<project-id>`, with their last run. */
export async function GET(req: Request) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return ok({ workflows: [] })
    const scope = await resolveScopeParam(currentPath, req.url)
    if (!scope.ok) return fail(scope.error, scope.status)
    return ok({ workflows: await listWorkflowItems(currentPath, scope.scope) })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const scope = await resolveScopeParam(currentPath, req.url)
    if (!scope.ok) return fail(scope.error, scope.status)
    const parsed = await parseWorkflowBody(currentPath, await req.json().catch(() => null), scope.scope)
    if (!parsed.ok) return fail(parsed.message)
    if (await workflowExists(currentPath, parsed.workflow.name, scope.scope)) {
      return fail(`A workflow named "${parsed.workflow.name}" already exists`, 409)
    }
    await saveWorkflow(currentPath, parsed.workflow, scope.scope)
    return ok({ workflow: parsed.workflow }, 201)
  })
}
