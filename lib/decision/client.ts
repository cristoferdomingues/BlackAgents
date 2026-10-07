import { TypeSafeClient } from "@typesafe-ai/sdk"

import { readSecrets } from "@/lib/secrets"
import { readAiSettings, type JevProviderPreference } from "@/lib/settings"

/**
 * Jev (TypeSafe "System One") is an optional, fast classifier. Only files in
 * `lib/decision/` import the SDK; callers use `evaluate*()` helpers that never
 * throw and fall back to the normal path when Jev is off or fails.
 */

export type DecisionProvider = "direct" | "openrouter"

export interface DecisionCredentials {
  enabled: boolean
  providerPreference: JevProviderPreference
  directApiKey: string | null
  openRouterApiKey: string | null
}

export interface ResolvedDecisionClient {
  provider: DecisionProvider
  client: TypeSafeClient
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api"
export const OPENROUTER_JEV_MODEL = "typesafe/jev-1.13"
/** Hot-path request options: fast, no retries. */
export const DECISION_REQUEST_OPTIONS = {
  timeout: 2_000,
  retry: { maxRetries: 0 },
} as const

export function isOpenRouterBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "openrouter.ai"
  } catch {
    return false
  }
}

/** Which provider would be used, without building the SDK client. */
export function resolveDecisionProvider(
  credentials: DecisionCredentials
): DecisionProvider | null {
  if (!credentials.enabled) return null
  if (credentials.providerPreference === "openrouter") {
    return credentials.openRouterApiKey ? "openrouter" : null
  }
  if (credentials.directApiKey) return "direct"
  if (credentials.providerPreference === "auto" && credentials.openRouterApiKey) {
    return "openrouter"
  }
  return null
}

export function resolveDecisionClient(
  credentials: DecisionCredentials
): ResolvedDecisionClient | null {
  const provider = resolveDecisionProvider(credentials)
  if (provider === "direct" && credentials.directApiKey) {
    return { provider, client: new TypeSafeClient({ apiKey: credentials.directApiKey }) }
  }
  if (provider === "openrouter" && credentials.openRouterApiKey) {
    return {
      provider,
      client: new TypeSafeClient({
        apiKey: credentials.openRouterApiKey,
        baseURL: OPENROUTER_BASE_URL,
        defaultModel: OPENROUTER_JEV_MODEL,
      }),
    }
  }
  return null
}

/**
 * Read Jev settings + keys. The OpenRouter key is reused only when the custom
 * provider points exactly at openrouter.ai.
 */
export async function getDecisionCredentials(): Promise<DecisionCredentials> {
  const [settings, secrets] = await Promise.all([readAiSettings(), readSecrets()])
  const custom = secrets.providers.custom
  return {
    enabled: settings.jev.enabled,
    providerPreference: settings.jev.provider,
    directApiKey: secrets.jev?.apiKey ?? null,
    openRouterApiKey:
      custom?.apiKey && isOpenRouterBaseUrl(custom.baseUrl) ? custom.apiKey : null,
  }
}

/** Resolve once per request; `null` means Jev is off or has no key. */
export async function loadDecisionClient(): Promise<ResolvedDecisionClient | null> {
  try {
    return resolveDecisionClient(await getDecisionCredentials())
  } catch {
    return null
  }
}

export function decisionErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}
