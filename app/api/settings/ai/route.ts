import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { getDecisionCredentials, resolveDecisionProvider } from "@/lib/decision/client"
import { jevKeyStatus, readSecrets, setJevApiKey } from "@/lib/secrets"
import { aiSettingsPatchSchema, readAiSettings, updateAiSettings } from "@/lib/settings"

const putSchema = aiSettingsPatchSchema.extend({
  /** Write-only. A string saves the key, `null` removes it. */
  jevApiKey: z.string().trim().min(8, "The key looks too short").max(500).nullable().optional(),
})

async function snapshot() {
  const [settings, secrets, credentials] = await Promise.all([
    readAiSettings(),
    readSecrets(),
    getDecisionCredentials(),
  ])
  return {
    settings,
    jevKey: jevKeyStatus(secrets),
    openRouterAvailable: Boolean(credentials.openRouterApiKey),
    activeProvider: resolveDecisionProvider(credentials),
  }
}

/** Assistant limits + Jev switches. Keys are never returned, only `last4`. */
export async function GET() {
  return handle(async () => ok(await snapshot()))
}

export async function PUT(req: Request) {
  return handle(async () => {
    const parsed = putSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid settings")
    const { jevApiKey, ...patch } = parsed.data
    await updateAiSettings(patch)
    if (jevApiKey !== undefined) await setJevApiKey(jevApiKey)
    return ok(await snapshot())
  })
}
