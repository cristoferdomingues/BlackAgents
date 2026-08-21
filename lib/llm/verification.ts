import { ProviderError, type LLMCredentials, type LLMProvider } from "./types"

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/**
 * Verify an OpenAI-compatible endpoint without generating content. A successful
 * `/models` response proves both connectivity and (when required) credentials.
 */
export async function verifyOpenAICompatibleConnection(
  baseUrl: string,
  apiKey: string,
  label: string
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      headers: authHeaders(apiKey),
    })
  } catch {
    throw new ProviderError(`Could not connect to ${label}`, 502)
  }

  if (!response.ok) {
    throw new ProviderError(
      `${label} credential verification failed (${response.status})`,
      response.status
    )
  }
}

/** Run a provider's bounded, non-generating credential check. */
export async function verifyProviderCredentials(
  provider: LLMProvider,
  credentials: LLMCredentials
): Promise<void> {
  try {
    await provider.verify(credentials)
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError(`Could not verify ${provider.label} credentials`, 502)
  }
}
