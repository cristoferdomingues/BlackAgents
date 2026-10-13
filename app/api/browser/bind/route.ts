import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import {
  bindFlowArtifacts,
  readBrowserFlow,
  saveDailyBrowserWorkflow,
} from "@/lib/browser"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"

const bodySchema = z.object({
  flowName: nameSchema,
  agentName: nameSchema.optional(),
  skillName: nameSchema.optional(),
  overwrite: z.boolean().optional().default(true),
  daily: z
    .object({
      workflowName: nameSchema,
      at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)"),
      task: z.string().trim().min(1).max(4_000),
      description: z.string().trim().max(300).optional(),
    })
    .optional(),
})

/** Create skill/agent (and optional daily workflow) for a saved flow. */
export async function POST(req: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return fail("No active workspace selected", 400)

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
    }

    const flow = await readBrowserFlow(config.currentPath, parsed.data.flowName)
    if (!flow) return fail(`Flow "${parsed.data.flowName}" not found`, 404)

    const agentName = parsed.data.agentName ?? `${flow.name}-agent`
    const binding = await bindFlowArtifacts(config.currentPath, flow, {
      overwrite: parsed.data.overwrite,
      agentName,
      skillName: parsed.data.skillName,
    })

    const workflow = parsed.data.daily
      ? await saveDailyBrowserWorkflow(config.currentPath, {
          workflowName: parsed.data.daily.workflowName,
          agentName,
          flowName: flow.name,
          at: parsed.data.daily.at,
          task: parsed.data.daily.task,
          description: parsed.data.daily.description,
        })
      : null

    return ok({ binding, workflow })
  })
}
