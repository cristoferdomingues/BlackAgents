/**
 * Provider contract for the upcoming bring-your-own-key chat phase.
 *
 * This is the architectural seam (not yet wired to UI): a chat screen will let
 * the user pick a provider and supply an API key, then the assistant generates
 * or edits artifacts through the existing /api/artifacts routes, using the
 * authoring standards (/api/standards) as system context. Keeping the contract
 * here lets the model layer and the future chat UI evolve independently.
 */

export type ProviderId = "openai" | "anthropic" | "custom"

export type ChatRole = "system" | "user" | "assistant"

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface LLMGenerateRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  /** Authoring standards + artifact registry injected as system context. */
  systemContext?: string
}

export interface LLMGenerateResult {
  content: string
  model: string
}

export interface LLMProvider {
  id: ProviderId
  label: string
  /** Default model identifiers offered to the user for this provider. */
  models: string[]
  generate(request: LLMGenerateRequest, apiKey: string): Promise<LLMGenerateResult>
}
