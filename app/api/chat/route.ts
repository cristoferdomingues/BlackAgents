import { ok, fail, handle } from "@/lib/api-response"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import { buildSystemContext } from "@/lib/llm/context"
import { getProviderSecret } from "@/lib/secrets"
import { ProviderError, type ChatMessage, type ChatRole } from "@/lib/llm/types"

interface ChatBody {
  provider?: string
  model?: string
  messages?: Array<{ role?: string; content?: string }>
  temperature?: number
}

const ROLES: ChatRole[] = ["system", "user", "assistant"]

function sanitizeMessages(raw: ChatBody["messages"]): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (m): m is { role: ChatRole; content: string } =>
        typeof m?.content === "string" &&
        typeof m?.role === "string" &&
        ROLES.includes(m.role as ChatRole)
    )
    .map((m) => ({ role: m.role, content: m.content }))
}

/**
 * Bring-your-own-key chat. The API key stays server-side: it is read from the
 * local secrets file, never accepted from or returned to the client. The
 * authoring standards + workspace registry are injected as system context.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as ChatBody | null
    if (!body?.provider || !isProviderId(body.provider)) {
      return fail("Unknown provider")
    }
    const provider = getProvider(body.provider)
    if (!provider) return fail("Unknown provider")

    const model = body.model?.trim() || provider.models[0]
    if (!model) return fail("A model is required for this provider")

    const messages = sanitizeMessages(body.messages)
    if (messages.length === 0) return fail("At least one message is required")

    const secret = await getProviderSecret(provider.id)
    if (provider.requiresBaseUrl && !secret?.baseUrl) {
      return fail(`Configure a base URL for ${provider.label} first`, 412)
    }
    if (!provider.requiresBaseUrl && !secret?.apiKey) {
      return fail(`No API key configured for ${provider.label}`, 412)
    }

    const systemContext = await buildSystemContext()

    try {
      const result = await provider.generate(
        { model, messages, temperature: body.temperature, systemContext },
        { apiKey: secret?.apiKey ?? "", baseUrl: secret?.baseUrl }
      )
      return ok(result)
    } catch (err) {
      if (err instanceof ProviderError) return fail(err.message, err.status)
      throw err
    }
  })
}
