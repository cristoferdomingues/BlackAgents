import { fail, handle, ok } from "@/lib/api-response"
import { isOpenRouterBaseUrl } from "@/lib/decision/client"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import { resolveTaskModel } from "@/lib/llm/task-models"
import {
  supportsTranscription,
  transcribeAudio,
  transcribeRequestSchema,
  VOICE_MODEL_MISSING,
} from "@/lib/llm/transcribe"
import { ProviderError } from "@/lib/llm/types"
import { readAiSettings } from "@/lib/settings"

/**
 * Voice fallback for the chat input: a recorded WAV clip becomes text with
 * the selected provider's verified key. The key never leaves the server.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = transcribeRequestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    const request = parsed.data

    if (!isProviderId(request.provider)) return fail("Unknown provider")
    const provider = getProvider(request.provider)
    if (!provider) return fail("Unknown provider")
    if (!supportsTranscription(provider.id)) {
      return fail("Voice fallback needs an OpenAI or custom provider", 412)
    }

    let verified: Awaited<ReturnType<typeof getVerifiedCredentials>>
    try {
      verified = await getVerifiedCredentials(provider)
    } catch (error) {
      if (error instanceof CredentialStateError) return fail(error.message, error.status)
      throw error
    }

    let model = request.model
    if (provider.id === "custom" && !model) {
      const settings = await readAiSettings()
      model = resolveTaskModel(
        "voice",
        settings.models.voice,
        isOpenRouterBaseUrl(verified.credentials.baseUrl)
      )
      if (!model) return fail(VOICE_MODEL_MISSING, 412)
    }

    try {
      const text = await transcribeAudio(provider.id, { ...request, model }, verified.credentials)
      return ok({ text })
    } catch (err) {
      if (err instanceof ProviderError) {
        await markInvalidOnAuthFailure(provider, err, verified.secret)
        return fail(err.message, err.status)
      }
      throw err
    }
  })
}
