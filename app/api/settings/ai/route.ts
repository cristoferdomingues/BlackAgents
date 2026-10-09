import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import {
  aiOpenRouterApiKey,
  getDecisionCredentials,
  resolveDecisionProvider,
} from "@/lib/decision/client"
import {
  jevKeyStatus,
  jevOpenRouterKeyStatus,
  readSecrets,
  setJevApiKey,
  setJevOpenRouterApiKey,
} from "@/lib/secrets"
import { aiSettingsPatchSchema, readAiSettings, updateAiSettings } from "@/lib/settings"

const writeOnlyKey = z.string().trim().min(8, "The key looks too short").max(500).nullable()

const putSchema = aiSettingsPatchSchema.extend({
  /** Write-only TypeSafe key. A string saves it, `null` removes it. */
  jevApiKey: writeOnlyKey.optional(),
  /** Write-only Jev-only OpenRouter key. A string saves it, `null` removes it. */
  jevOpenRouterApiKey: writeOnlyKey.optional(),
})

async function snapshot() {
  const [settings, secrets, credentials] = await Promise.all([
    readAiSettings(),
    readSecrets(),
    getDecisionCredentials(),
  ])
  const aiOpenRouterKey = aiOpenRouterApiKey(secrets)
  return {
    settings,
    jevKey: jevKeyStatus(secrets),
    jevOpenRouterKey: jevOpenRouterKeyStatus(secrets),
    aiOpenRouter: aiOpenRouterKey
      ? { available: true as const, last4: aiOpenRouterKey.slice(-4) }
      : { available: false as const },
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
    const { jevApiKey, jevOpenRouterApiKey, ...patch } = parsed.data
    await updateAiSettings(patch)
    if (jevApiKey !== undefined) await setJevApiKey(jevApiKey)
    if (jevOpenRouterApiKey !== undefined) await setJevOpenRouterApiKey(jevOpenRouterApiKey)
    return ok(await snapshot())
  })
}
