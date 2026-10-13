import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import {
  bindFlowArtifacts,
  flowStepsFromTraces,
  saveBrowserFlow,
  startUrlFromSteps,
} from "@/lib/browser"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"

const traceSchema = z.object({
  id: z.string(),
  server: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()).default({}),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
})

const bodySchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).optional(),
  traces: z.array(traceSchema).min(1).max(200),
  bind: z.boolean().optional().default(true),
})

/**
 * Coach mode: turn chat tool-execution traces into a saved browser flow.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return fail("No active workspace selected", 400)

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
    }

    const steps = flowStepsFromTraces(parsed.data.traces)
    if (steps.length === 0) {
      return fail(
        "No successful browser MCP tool calls found in the traces",
        400
      )
    }

    const flow = await saveBrowserFlow(config.currentPath, {
      name: parsed.data.name,
      description: parsed.data.description,
      steps,
      startUrl: startUrlFromSteps(steps),
    })

    const binding = parsed.data.bind
      ? await bindFlowArtifacts(config.currentPath, flow, { overwrite: true })
      : null

    return ok({ flow, binding })
  })
}
