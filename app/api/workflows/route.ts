import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { listWorkflowItems, parseWorkflowBody } from "@/lib/workflows/service"
import { saveWorkflow, workflowExists } from "@/lib/workflows/store"

/** Workflows of the active workspace, with their last run. */
export async function GET() {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return ok({ workflows: [] })
    return ok({ workflows: await listWorkflowItems(currentPath) })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const parsed = await parseWorkflowBody(currentPath, await req.json().catch(() => null))
    if (!parsed.ok) return fail(parsed.message)
    if (await workflowExists(currentPath, parsed.workflow.name)) {
      return fail(`A workflow named "${parsed.workflow.name}" already exists`, 409)
    }
    await saveWorkflow(currentPath, parsed.workflow)
    return ok({ workflow: parsed.workflow }, 201)
  })
}
