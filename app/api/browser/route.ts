import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import {
  browserMcpStatus,
  collectFlowSecretIds,
  ensureBrowserMcpSetup,
  getRecording,
  listBrowserFlows,
} from "@/lib/browser"
import { readConfig } from "@/lib/config"
import { browserSecretsStatus, readSecrets } from "@/lib/secrets"
import { readAiSettings } from "@/lib/settings"

/** Browser automation status for the active workspace (desktop gate + flows). */
export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return ok({
        desktop: false,
        configured: false,
        disabled: false,
        profileDir: "",
        profileExists: false,
        reason: "No active workspace selected",
        flows: [],
        recording: null,
        updateFlowsOnHeal: false,
        secretStatuses: {},
      })
    }

    const [status, flows, settings, secrets] = await Promise.all([
      browserMcpStatus(config.currentPath),
      listBrowserFlows(config.currentPath),
      readAiSettings(),
      readSecrets(),
    ])
    const recording = getRecording(config.currentPath)
    const secretIds = [
      ...new Set(flows.flatMap((f) => collectFlowSecretIds(f.steps))),
    ]

    return ok({
      ...status,
      updateFlowsOnHeal: settings.browser.updateFlowsOnHeal,
      secretStatuses: browserSecretsStatus(secrets, secretIds),
      flows: flows.map((f) => ({
        name: f.name,
        description: f.description,
        stepCount: f.steps.length,
        profile: f.profile,
        startUrl: f.startUrl,
        updatedAt: f.updatedAt,
        secretIds: collectFlowSecretIds(f.steps),
      })),
      recording: recording
        ? {
            startedAt: recording.startedAt,
            stepCount: recording.steps.length,
            steps: recording.steps,
          }
        : null,
    })
  })
}

const postSchema = z.object({
  action: z.literal("setup"),
  profile: z.string().trim().min(1).max(64).optional(),
})

/** Register Playwright MCP + risky trust (desktop only). */
export async function POST(req: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return fail("No active workspace selected", 400)
    }

    const json = await req.json().catch(() => null)
    const parsed = postSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
    }

    const result = await ensureBrowserMcpSetup(
      config.currentPath,
      parsed.data.profile
    )
    if (!result.configured) {
      return fail(result.reason ?? "Could not configure browser MCP", 412)
    }

    return ok(result)
  })
}
