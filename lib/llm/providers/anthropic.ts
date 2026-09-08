import {
  ProviderError,
  type LLMCredentials,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
  type ToolCall,
} from "../types"

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface AnthropicMessage {
  content?: AnthropicContentBlock[]
}

async function verifyAnthropic(apiKey: string): Promise<void> {
  let response: Response
  try {
    response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    })
  } catch {
    throw new ProviderError("Could not connect to Anthropic", 502)
  }

  if (!response.ok) {
    throw new ProviderError(
      `Anthropic credential verification failed (${response.status})`,
      response.status
    )
  }
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
  verify(credentials: LLMCredentials): Promise<void> {
    return verifyAnthropic(credentials.apiKey)
  },
  async generate(
    request: LLMGenerateRequest,
    credentials: LLMCredentials
  ): Promise<LLMGenerateResult> {
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [
              {
                type: "tool_result",
                tool_use_id: m.tool_call_id,
                content: m.content,
              },
            ],
          }
        }
        if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
          const contentBlocks: unknown[] = []
          if (m.content) contentBlocks.push({ type: "text", text: m.content })
          for (const tc of m.tool_calls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })
          }
          return { role: "assistant" as const, content: contentBlocks }
        }
        return { role: m.role, content: m.content }
      })

    const bodyPayload: Record<string, unknown> = {
      model: request.model,
      max_tokens: 4096,
      temperature: request.temperature ?? 0.4,
      system: request.systemContext,
      messages,
    }

    if (request.tools && request.tools.length > 0) {
      bodyPayload.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": credentials.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(bodyPayload),
    })

    const json = (await res.json().catch(() => null)) as AnthropicMessage | null
    if (!res.ok) {
      throw new ProviderError(
        `Anthropic request failed (${res.status})`,
        res.status
      )
    }

    const content = (json?.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")

    const toolCalls: ToolCall[] = (json?.content ?? [])
      .filter((block) => block.type === "tool_use" && Boolean(block.id && block.name))
      .map((block) => ({
        id: block.id!,
        name: block.name!,
        arguments: block.input ?? {},
      }))

    if (!content && toolCalls.length === 0) {
      throw new ProviderError("Anthropic returned an empty response", 502)
    }

    return {
      content,
      model: request.model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  },
}
