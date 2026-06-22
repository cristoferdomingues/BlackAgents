import {
  ProviderError,
  type LLMCredentials,
  type LLMGenerateRequest,
  type LLMGenerateResult,
  type LLMProvider,
} from "../types"
import { openAICompatibleGenerate } from "./openai"

/**
 * Any OpenAI-compatible endpoint (local Ollama/LM Studio, Groq, OpenRouter, an
 * internal gateway, …). The user supplies the base URL alongside the key.
 */
export const customProvider: LLMProvider = {
  id: "custom",
  label: "Custom (OpenAI-compatible)",
  models: [],
  requiresBaseUrl: true,
  generate(
    request: LLMGenerateRequest,
    credentials: LLMCredentials
  ): Promise<LLMGenerateResult> {
    if (!credentials.baseUrl) {
      throw new ProviderError(
        "Custom provider requires a base URL (e.g. http://localhost:11434/v1)",
        400
      )
    }
    return openAICompatibleGenerate(
      credentials.baseUrl,
      request,
      credentials.apiKey || "not-needed"
    )
  },
}
