/**
 * Provider contract for the upcoming bring-your-own-key chat phase.
 *
 * This is the architectural seam (not yet wired to UI): a chat screen will let
 * the user pick a provider and supply an API key, then the assistant generates
 * or edits artifacts through the existing /api/artifacts routes, using the
 * authoring standards (/api/standards) as system context. Keeping the contract
 * here lets the model layer and the future chat UI evolve independently.
 */

import type { ToolExecutionTrace } from "@/lib/mcp/types"

export type ProviderId = "openai" | "anthropic" | "custom"

export type ChatRole = "system" | "user" | "assistant" | "tool"

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: ChatRole
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface LLMToolDefinition {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface LLMGenerateRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  /** Authoring standards + artifact registry injected as system context. */
  systemContext?: string
  tools?: LLMToolDefinition[]
}

export interface LLMGenerateResult {
  content: string
  model: string
  toolCalls?: ToolCall[]
  toolExecutions?: ToolExecutionTrace[]
}

export interface LLMCredentials {
  apiKey: string
  /** Custom (OpenAI-compatible) provider only: the endpoint base URL. */
  baseUrl?: string
}

export interface LLMProvider {
  id: ProviderId
  label: string
  /** Default model identifiers offered to the user for this provider. */
  models: string[]
  /** Whether this provider requires a user-supplied base URL (custom). */
  requiresBaseUrl?: boolean
  /** Verify credentials through a non-generating provider endpoint. */
  verify(credentials: LLMCredentials): Promise<void>
  generate(
    request: LLMGenerateRequest,
    credentials: LLMCredentials
  ): Promise<LLMGenerateResult>
}

/** Raised by providers on a non-2xx upstream response. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "ProviderError"
  }
}
