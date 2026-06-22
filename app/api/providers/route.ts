import { ok, fail, handle } from "@/lib/api-response"
import { describeProviders, isProviderId, PROVIDER_IDS } from "@/lib/llm/registry"
import {
  readSecrets,
  removeProviderSecret,
  setDefaults,
  setProviderSecret,
  toStatusList,
} from "@/lib/secrets"
import type { ProviderId } from "@/lib/llm/types"

async function state() {
  const secrets = await readSecrets()
  return {
    providers: describeProviders(),
    status: toStatusList(secrets, PROVIDER_IDS),
    defaults: secrets.defaults ?? {},
  }
}

/** Provider catalog + redacted key status + defaults. Never returns raw keys. */
export async function GET() {
  return handle(async () => ok(await state()))
}

interface SetKeyBody {
  id?: string
  apiKey?: string
  baseUrl?: string
}

/** Store (or replace) an API key for a provider. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as SetKeyBody | null
    if (!body?.id || !isProviderId(body.id)) return fail("Unknown provider")
    const apiKey = body.apiKey?.trim() ?? ""
    const baseUrl = body.baseUrl?.trim()
    if (body.id === "custom" && !baseUrl) {
      return fail("Custom provider requires a base URL")
    }
    if (body.id !== "custom" && !apiKey) {
      return fail("API key is required")
    }
    await setProviderSecret(body.id, { apiKey, baseUrl })
    return ok(await state())
  })
}

interface DefaultsBody {
  provider?: string
  model?: string
}

/** Set the default provider/model used to pre-select the chat pickers. */
export async function PUT(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => null)) as DefaultsBody | null
    if (body?.provider && !isProviderId(body.provider)) {
      return fail("Unknown provider")
    }
    await setDefaults({
      provider: body?.provider as ProviderId | undefined,
      model: body?.model,
    })
    return ok(await state())
  })
}

/** Remove a stored key. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const id = new URL(req.url).searchParams.get("id")
    if (!id || !isProviderId(id)) return fail("Unknown provider")
    await removeProviderSecret(id)
    return ok(await state())
  })
}
