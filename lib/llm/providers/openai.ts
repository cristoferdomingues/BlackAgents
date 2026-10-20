import { PROVIDER_URLS } from "@/lib/app-config"
import type { BinaryAttachment } from "@/lib/chat/attachments"

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
    } else if (m.role === "user" && m.attachments && m.attachments.length > 0) {
      messages.push({ role: "user", content: toOpenAIUserContent(m.content, m.attachments) })
    } else {
      messages.push({
        role: m.role,
        content: m.content,
      })
    }
  }
  return messages
}

/** A user turn with files as OpenAI content parts (text, image_url, file). */
export function toOpenAIUserContent(
  text: string,
  attachments: BinaryAttachment[]
): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = []
  if (text) parts.push({ type: "text", text })
  for (const a of attachments) {
    if (a.kind === "image") {
      parts.push({ type: "image_url", image_url: { url: `data:${a.mimeType};base64,${a.data}` } })
    } else {
      parts.push({
        type: "file",
        file: { filename: a.name, file_data: `data:application/pdf;base64,${a.data}` },
      })
    }
  }
  return parts
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
      /** DeepSeek / vLLM style. */
      reasoning_content?: unknown
      /** OpenRouter / Ollama style. */
      reasoning?: unknown
      tool_calls?: OpenAIToolCall[]
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
  error?: {
    message?: unknown
    code?: unknown
  }
}

const THINK_BLOCK = /<think>([\s\S]*?)(?:<\/think>|$)/gi

/** Pull `<think>…</think>` blocks (local reasoning models) out of the reply. */
export function splitThinkBlocks(content: string): { content: string; reasoning: string } {
  const parts: string[] = []
  const rest = content.replace(THINK_BLOCK, (_, inner: string) => {
    if (inner.trim()) parts.push(inner.trim())
    return ""
  })
  return { content: parts.length > 0 ? rest.trim() : rest, reasoning: parts.join("\n\n") }
}

/** Shared OpenAI-compatible call used by both the OpenAI and custom providers. */
export async function openAICompatibleGenerate(
  baseUrl: string,
  request: LLMGenerateRequest,
  apiKey: string,
  signal?: AbortSignal
): Promise<LLMGenerateResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const bodyPayload: Record<string, unknown> = {
    model: request.model,
    messages: toOpenAIMessages(request),
    temperature: request.temperature ?? 0.4,
    // Prevent compatible providers from using an extreme model default
    // (one OpenRouter response produced 131k tokens and 2,994 tool calls).
    max_tokens: 8_192,
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
    signal,
  })

  const json = (await res.json().catch(() => null)) as OpenAICompletion | null
  if (!res.ok) {
    throw new ProviderError(safeProviderError(json, res.status), res.status)
  }

  const choice = json?.choices?.[0]
  const split = splitThinkBlocks(choice?.message?.content ?? "")
  const content = split.content
  const fieldReasoning = [choice?.message?.reasoning_content, choice?.message?.reasoning].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  )
  const reasoning = [fieldReasoning?.trim(), split.reasoning].filter(Boolean).join("\n\n")
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

  const usage =
    typeof json?.usage?.prompt_tokens === "number" &&
    typeof json?.usage?.completion_tokens === "number"
      ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
      : undefined

  return {
    content,
    model: request.model,
    toolCalls,
    ...(reasoning ? { reasoning } : {}),
    ...(usage ? { usage } : {}),
  }
}

/** Turn common upstream 400s into useful text without exposing its raw body. */
export function safeProviderError(json: OpenAICompletion | null, status: number): string {
  const raw = typeof json?.error?.message === "string" ? json.error.message.toLowerCase() : ""
  if (/context|token|maximum.*length|too long/.test(raw)) {
    return `Provider rejected the request because its context or token limit was exceeded (${status})`
  }
  if (/tool|function/.test(raw)) {
    return `Provider rejected the tool-call request; check that the model supports tools (${status})`
  }
  if (/parameter|unsupported|invalid.*request/.test(raw)) {
    return `Provider rejected an unsupported request parameter (${status})`
  }
  return `Provider request failed (${status})`
}

export const openAIProvider: LLMProvider = {
  id: "openai",
  label: "OpenAI",
  models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  verify(credentials: LLMCredentials): Promise<void> {
    return verifyOpenAICompatibleConnection(
      PROVIDER_URLS.openai,
      credentials.apiKey,
      "OpenAI"
    )
  },
  generate(request: LLMGenerateRequest, credentials: LLMCredentials, signal?: AbortSignal) {
    return openAICompatibleGenerate(
      PROVIDER_URLS.openai,
      request,
      credentials.apiKey,
      signal
    )
  },
}
