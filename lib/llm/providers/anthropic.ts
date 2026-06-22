import {
  ProviderError,
  type LLMCredentials,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
} from "../types"

interface AnthropicMessage {
  content?: Array<{ type: string; text?: string }>
  error?: { message?: string }
}

/**
 * Anthropic Messages API. The system context is sent at the top level (not as a
 * message), and only user/assistant turns are forwarded.
 */
export const anthropicProvider: LLMProvider = {
  id: "anthropic",
  label: "Anthropic",
  models: [
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
  async generate(
    request: LLMGenerateRequest,
    credentials: LLMCredentials
  ): Promise<LLMGenerateResult> {
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }))

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": credentials.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 4096,
        temperature: request.temperature ?? 0.4,
        system: request.systemContext,
        messages,
      }),
    })

    const json = (await res.json().catch(() => null)) as AnthropicMessage | null
    if (!res.ok) {
      throw new ProviderError(
        json?.error?.message ?? `Anthropic request failed (${res.status})`,
        res.status
      )
    }
    const content = json?.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
    if (!content) {
      throw new ProviderError("Anthropic returned an empty response", 502)
    }
    return { content, model: request.model }
  },
}
