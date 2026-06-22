import type { LLMProvider, ProviderId } from "./types"
import { openAIProvider } from "./providers/openai"
import { anthropicProvider } from "./providers/anthropic"
import { customProvider } from "./providers/custom"

const PROVIDERS: Record<ProviderId, LLMProvider> = {
  openai: openAIProvider,
  anthropic: anthropicProvider,
  custom: customProvider,
}

export const PROVIDER_LIST: LLMProvider[] = [
  openAIProvider,
  anthropicProvider,
  customProvider,
]

export const PROVIDER_IDS: ProviderId[] = PROVIDER_LIST.map((p) => p.id)

export function getProvider(id: string): LLMProvider | undefined {
  return PROVIDERS[id as ProviderId]
}

export function isProviderId(id: string): id is ProviderId {
  return id in PROVIDERS
}

/** Client-safe descriptor (no credentials). */
export interface ProviderDescriptor {
  id: ProviderId
  label: string
  models: string[]
  requiresBaseUrl: boolean
}

export function describeProviders(): ProviderDescriptor[] {
  return PROVIDER_LIST.map((p) => ({
    id: p.id,
    label: p.label,
    models: p.models,
    requiresBaseUrl: Boolean(p.requiresBaseUrl),
  }))
}
