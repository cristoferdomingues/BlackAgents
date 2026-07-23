import { ok, fail, handle } from "@/lib/api-response"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import {
  listOpenAICompatibleModels,
  mergeModelLists,
} from "@/lib/llm/list-models"
import { getProviderSecret } from "@/lib/secrets"
import { ProviderError } from "@/lib/llm/types"

/**
 * Available model ids for a provider: curated static list, plus a live
 * `/models` fetch for OpenAI-compatible endpoints when credentials exist.
 * Never returns API keys.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const id = new URL(req.url).searchParams.get("id")
    if (!id || !isProviderId(id)) return fail("Unknown provider")

    const provider = getProvider(id)!
    const staticModels = provider.models
    const secret = await getProviderSecret(id)

    const canListLive =
      (id === "openai" && Boolean(secret?.apiKey)) ||
      (id === "custom" && Boolean(secret?.baseUrl))

    if (!canListLive) {
      return ok({ models: staticModels, source: "static" as const })
    }

    const baseUrl =
      id === "openai" ? "https://api.openai.com/v1" : secret!.baseUrl!
    const apiKey = secret?.apiKey || "not-needed"

    try {
      const live = await listOpenAICompatibleModels(baseUrl, apiKey)
      return ok({
        models: mergeModelLists(staticModels, live),
        source: "live" as const,
      })
    } catch (err) {
      if (err instanceof ProviderError) {
        // Credentials may be wrong or the endpoint may not support /models —
        // still return the curated list so the picker stays usable.
        return ok({
          models: staticModels,
          source: "static" as const,
          warning: err.message,
        })
      }
      throw err
    }
  })
}
