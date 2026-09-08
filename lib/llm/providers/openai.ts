import {
  ProviderError,
  type LLMCredentials,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
  type ToolCall,
} from "../types"
import { verifyOpenAICompatibleConnection } from "../verification"

/**
 * Builds the message array for an OpenAI-style /chat/completions call,
 * prepending the authoring-standards system context when present.
 */
export function toOpenAIMessages(request: LLMGenerateRequest): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = []
  if (request.systemContext) {
    messages.push({ role: "system", content: request.systemContext })
  }
  for (const m of request.messages) {
    if (m.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.content,
      })
    } else if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      })
    } else {
      messages.push({
        role: m.role,
        content: m.content,
      })
    }
  }
  return messages
}

interface OpenAIToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

interface OpenAICompletion {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
  }>
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

  const bodyPayload: Record<string, unknown> = {
    model: request.model,
    messages: toOpenAIMessages(request),
    temperature: request.temperature ?? 0.4,
  }

  if (request.tools && request.tools.length > 0) {
    bodyPayload.tools = request.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(bodyPayload),
  })

  const json = (await res.json().catch(() => null)) as OpenAICompletion | null
  if (!res.ok) {
    throw new ProviderError(
      `Provider request failed (${res.status})`,
      res.status
    )
  }

  const choice = json?.choices?.[0]
  const content = choice?.message?.content ?? ""
  const rawToolCalls = choice?.message?.tool_calls

  let toolCalls: ToolCall[] | undefined
  if (rawToolCalls && rawToolCalls.length > 0) {
    toolCalls = rawToolCalls.map((tc) => {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments)
      } catch {
        args = {}
      }
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: args,
      }
    })
  }

  if (!content && (!toolCalls || toolCalls.length === 0)) {
    throw new ProviderError("Provider returned an empty response", 502)
  }

  return { content, model: request.model, toolCalls }
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
