import { ok, fail, handle } from "@/lib/api-response"
import { listProviderModels } from "@/lib/llm/list-models"
import { isProviderId } from "@/lib/llm/registry"

/**
 * Available model ids for a provider. Live lists are merged in
 * {@link listProviderModels}. The response stays a list of ids so existing
 * pickers keep working. Never returns API keys.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const id = new URL(req.url).searchParams.get("id")
    if (!id || !isProviderId(id)) return fail("Unknown provider")

    const listed = await listProviderModels(id)
    return ok({
      models: listed.models.map((model) => model.id),
      source: listed.source,
      ...(listed.warning ? { warning: listed.warning } : {}),
    })
  })
}
