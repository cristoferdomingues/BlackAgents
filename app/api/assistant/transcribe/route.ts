import { fail, handle, ok } from "@/lib/api-response"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import { supportsTranscription, transcribeAudio, transcribeRequestSchema } from "@/lib/llm/transcribe"
import { ProviderError } from "@/lib/llm/types"

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

    try {
      const text = await transcribeAudio(provider.id, request, verified.credentials)
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
