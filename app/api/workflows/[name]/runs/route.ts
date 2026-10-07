import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"
import { CredentialStateError } from "@/lib/llm/credentials"
import { resolveRunLlm } from "@/lib/workflows/llm"
import { getRunner } from "@/lib/workflows/runner"
import { summarizeRun } from "@/lib/workflows/schema"
import { listRuns, readWorkflow } from "@/lib/workflows/store"

interface RouteContext {
  params: Promise<{ name: string }>
}

const startSchema = z.object({ task: z.string().max(4_000).optional() })

export async function GET(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { name } = await ctx.params
    if (!nameSchema.safeParse(name).success) return fail("Invalid workflow name")
    const { currentPath } = await readConfig()
    if (!currentPath) return ok({ runs: [] })
    return ok({ runs: (await listRuns(currentPath, name)).map(summarizeRun) })
  })
}

/** Start a manual run. Fails fast (412) when no usable AI provider is set up. */
export async function POST(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { name } = await ctx.params
    if (!nameSchema.safeParse(name).success) return fail("Invalid workflow name")
    const parsed = startSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const workflow = await readWorkflow(currentPath, name)
    if (!workflow) return fail("Workflow not found", 404)
    try {
      await resolveRunLlm({ provider: workflow.provider, model: workflow.model })
    } catch (err) {
      const status = err instanceof CredentialStateError ? err.status : 412
      return fail(err instanceof Error ? err.message : "No usable AI provider", status)
    }
    const run = await getRunner().enqueue({
      root: currentPath,
      workflow,
      trigger: "manual",
      task: parsed.data.task,
    })
    return ok({ run }, 201)
  })
}
