import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import {
  bindFlowArtifacts,
  ensureBrowserMcpSetup,
  getRecording,
  saveBrowserFlow,
  startRecording,
  startUrlFromSteps,
  stopRecording,
} from "@/lib/browser"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("status") }),
  z.object({
    action: z.literal("stop"),
    saveAs: nameSchema.optional(),
    description: z.string().trim().max(500).optional(),
    bind: z.boolean().optional().default(true),
  }),
])

/** Start / stop / inspect an in-memory browser recording session. */
export async function POST(req: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return fail("No active workspace selected", 400)

    const json = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
    }

    const root = config.currentPath

    if (parsed.data.action === "status") {
      const session = getRecording(root)
      return ok({
        active: Boolean(session),
        startedAt: session?.startedAt ?? null,
        stepCount: session?.steps.length ?? 0,
        steps: session?.steps ?? [],
      })
    }

    if (parsed.data.action === "start") {
      const setup = await ensureBrowserMcpSetup(root)
      if (!setup.configured) {
        return fail(setup.reason ?? "Browser MCP is not available", 412)
      }
      const session = startRecording(root)
      return ok({
        active: true,
        startedAt: session.startedAt,
        stepCount: 0,
        setup,
      })
    }

    const session = stopRecording(root)
    if (!session) {
      return fail("No active recording session", 400)
    }

    if (!parsed.data.saveAs) {
      return ok({
        discarded: true,
        stepCount: session.steps.length,
        steps: session.steps,
      })
    }

    if (session.steps.length === 0) {
      return fail("Recording has no steps to save", 400)
    }

    const flow = await saveBrowserFlow(root, {
      name: parsed.data.saveAs,
      description: parsed.data.description,
      steps: session.steps,
      startUrl: startUrlFromSteps(session.steps),
    })

    const binding = parsed.data.bind
      ? await bindFlowArtifacts(root, flow, { overwrite: true })
      : null

    return ok({ flow, binding, discarded: false })
  })
}
