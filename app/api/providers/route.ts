import { ok, fail, handle } from "@/lib/api-response"
import { z } from "zod"
import {
  describeProviders,
  getProvider,
  isProviderId,
  PROVIDER_IDS,
} from "@/lib/llm/registry"
import { verifyProviderCredentials } from "@/lib/llm/verification"
import {
  readSecrets,
  removeProviderSecret,
  setDefaults,
  setProviderSecret,
  toStatusList,
} from "@/lib/secrets"
import type { ProviderId } from "@/lib/llm/types"
import { ProviderError } from "@/lib/llm/types"

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

const setCredentialSchema = z.object({
  id: z.enum(["openai", "anthropic", "custom"]),
  apiKey: z.string().trim().default(""),
  baseUrl: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .trim()
      .url("Base URL must be a valid URL")
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
        message: "Base URL must use http or https",
      })
      .optional()
  ),
})

/** Store (or replace) an API key for a provider. */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = setCredentialSchema.safeParse(
      await req.json().catch(() => null)
    )
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    }
    const { id, apiKey, baseUrl } = parsed.data
    if (!isProviderId(id)) return fail("Unknown provider")
    if (id === "custom" && !baseUrl) {
      return fail("Custom provider requires a base URL")
    }
    if (id !== "custom" && !apiKey) {
      return fail("API key is required")
    }

    const adapter = getProvider(id)
    if (!adapter) return fail("Unknown provider")

    try {
      await verifyProviderCredentials(adapter, { apiKey, baseUrl })
    } catch (error) {
      if (error instanceof ProviderError) return fail(error.message, error.status)
      throw error
    }

    await setProviderSecret(id, {
      apiKey,
      baseUrl,
      verification: { status: "valid", checkedAt: new Date().toISOString() },
    })
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
