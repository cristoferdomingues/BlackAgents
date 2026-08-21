import {
  ProviderError,
  type ChatMessage,
  type LLMCredentials,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
} from "../types"
import { verifyOpenAICompatibleConnection } from "../verification"

/**
 * Builds the message array for an OpenAI-style /chat/completions call,
 * prepending the authoring-standards system context when present.
 */
export function toOpenAIMessages(request: LLMGenerateRequest): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (request.systemContext) {
    messages.push({ role: "system", content: request.systemContext })
  }
  return messages.concat(request.messages)
}

interface OpenAICompletion {
  choices?: Array<{ message?: { content?: string } }>
}

/** Shared OpenAI-compatible call used by both the OpenAI and custom providers. */
export async function openAICompatibleGenerate(
  baseUrl: string,
  request: LLMGenerateRequest,
  apiKey: string
): Promise<LLMGenerateResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: request.model,
      messages: toOpenAIMessages(request),
      temperature: request.temperature ?? 0.4,
    }),
  })

  const json = (await res.json().catch(() => null)) as OpenAICompletion | null
  if (!res.ok) {
    throw new ProviderError(
      `Provider request failed (${res.status})`,
      res.status
    )
  }
  const content = json?.choices?.[0]?.message?.content
  if (!content) {
    throw new ProviderError("Provider returned an empty response", 502)
  }
  return { content, model: request.model }
}

export const openAIProvider: LLMProvider = {
  id: "openai",
  label: "OpenAI",
  models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  verify(credentials: LLMCredentials): Promise<void> {
    return verifyOpenAICompatibleConnection(
      "https://api.openai.com/v1",
      credentials.apiKey,
      "OpenAI"
    )
  },
  generate(request: LLMGenerateRequest, credentials: LLMCredentials) {
    return openAICompatibleGenerate(
      "https://api.openai.com/v1",
      request,
      credentials.apiKey
    )
  },
}
