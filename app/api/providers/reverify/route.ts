import { z } from "zod"

import { fail, handle, ok } from "@/lib/api-response"
import { getProvider } from "@/lib/llm/registry"
import { ProviderError } from "@/lib/llm/types"
import { verifyProviderCredentials } from "@/lib/llm/verification"
import {
  getProviderSecret,
  setProviderVerification,
  toStatusList,
} from "@/lib/secrets"

const requestSchema = z.object({
  id: z.enum(["openai", "anthropic", "custom"]),
})

/** Re-run live verification for a stored credential without exposing it. */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = requestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    }

    const provider = getProvider(parsed.data.id)
    if (!provider) return fail("Unknown provider")
    const secret = await getProviderSecret(provider.id)
    if (provider.requiresBaseUrl && !secret?.baseUrl) {
      return fail(`Configure a base URL for ${provider.label} first`, 412)
    }
    if (!provider.requiresBaseUrl && !secret?.apiKey) {
      return fail(`No API key configured for ${provider.label}`, 412)
    }

    try {
      await verifyProviderCredentials(provider, {
        apiKey: secret?.apiKey ?? "",
        baseUrl: secret?.baseUrl,
      })
    } catch (error) {
      if (error instanceof ProviderError) {
        await setProviderVerification(
          provider.id,
          { status: "invalid", checkedAt: new Date().toISOString() },
          secret
        )
        return fail(error.message, error.status)
      }
      throw error
    }

    const updated = await setProviderVerification(
      provider.id,
      { status: "valid", checkedAt: new Date().toISOString() },
      secret
    )
    const [status] = toStatusList(updated, [provider.id])
    return ok(status)
  })
}
