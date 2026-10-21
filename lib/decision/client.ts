import { TypeSafeClient } from "@typesafe-ai/sdk"

import { DEFAULT_MODELS, PROVIDER_URLS } from "@/lib/app-config"
import { readSecrets, type SecretsFile } from "@/lib/secrets"
import {
  readAiSettings,
  type JevOpenRouterKeySource,
  type JevProviderPreference,
} from "@/lib/settings"

import {
  cutoffValues,
  DEFAULT_CUTOFFS,
  type DecisionRecord,
  type JevCutoffs,
  type TunableDecision,
} from "./cutoffs"
import { appendDecision } from "./log"

/**
 * Jev (TypeSafe "System One") is an optional, fast classifier. Only files in
 * `lib/decision/` import the SDK; callers use `evaluate*()` helpers that never
 * throw and fall back to the normal path when Jev is off or fails.
 */

export type DecisionProvider = "direct" | "openrouter"

export interface DecisionCredentials {
  enabled: boolean
  providerPreference: JevProviderPreference
  openRouterKeySource: JevOpenRouterKeySource
  directApiKey: string | null
  openRouterApiKey: string | null
  /** True when AI Providers → Custom points at openrouter.ai (key may be reused). */
  aiOpenRouterAvailable: boolean
}

export interface ResolvedDecisionClient {
  provider: DecisionProvider
  client: TypeSafeClient
  /** User cutoffs from settings; missing ones use the defaults. */
  cutoffs?: Partial<JevCutoffs>
  /** Where decisions are recorded. Absent in tests, so nothing is written. */
  log?: (record: DecisionRecord) => void
}

export const OPENROUTER_BASE_URL = PROVIDER_URLS.openRouter
export const OPENROUTER_JEV_MODEL = DEFAULT_MODELS.openRouter.jev
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

/** OpenRouter key from AI Providers → Custom, only when the host is openrouter.ai. */
export function aiOpenRouterApiKey(secrets: SecretsFile): string | null {
  const custom = secrets.providers.custom
  if (!custom?.apiKey || !isOpenRouterBaseUrl(custom.baseUrl)) return null
  return custom.apiKey
}

/**
 * Resolve which OpenRouter key Jev should use.
 * - `reuse` — AI Custom key when it is OpenRouter (Custom alone is not enough).
 * - `dedicated` — Jev-only OpenRouter key in secrets.jev.
 */
export function resolveOpenRouterApiKey(
  secrets: SecretsFile,
  source: JevOpenRouterKeySource
): string | null {
  if (source === "dedicated") return secrets.jev?.openRouterApiKey ?? null
  return aiOpenRouterApiKey(secrets)
}

/**
 * Read Jev settings + keys. OpenRouter may come from a dedicated Jev key or
 * from AI Providers → Custom when that provider is actually OpenRouter.
 */
export async function getDecisionCredentials(): Promise<DecisionCredentials> {
  const [settings, secrets] = await Promise.all([readAiSettings(), readSecrets()])
  const openRouterKeySource = settings.jev.openRouterKeySource
  const reused = aiOpenRouterApiKey(secrets)
  return {
    enabled: settings.jev.enabled,
    providerPreference: settings.jev.provider,
    openRouterKeySource,
    directApiKey: secrets.jev?.apiKey ?? null,
    openRouterApiKey: resolveOpenRouterApiKey(secrets, openRouterKeySource),
    aiOpenRouterAvailable: Boolean(reused),
  }
}

/** Resolve once per request; `null` means Jev is off or has no key. */
export async function loadDecisionClient(): Promise<ResolvedDecisionClient | null> {
  try {
    const [credentials, settings] = await Promise.all([getDecisionCredentials(), readAiSettings()])
    const resolved = resolveDecisionClient(credentials)
    if (!resolved) return null
    return {
      ...resolved,
      cutoffs: cutoffValues(settings.jev.cutoffs),
      log: (record) => {
        void appendDecision({ ...record, at: new Date().toISOString(), provider: resolved.provider })
      },
    }
  } catch {
    return null
  }
}

export function cutoffFor(resolved: ResolvedDecisionClient | null, kind: TunableDecision): number {
  return resolved?.cutoffs?.[kind] ?? DEFAULT_CUTOFFS[kind]
}

/** Record one Jev call. Never throws, so logging cannot break a decision. */
export function recordDecision(resolved: ResolvedDecisionClient | null, record: DecisionRecord): void {
  try {
    resolved?.log?.(record)
  } catch {
    // the log is best effort
  }
}

export function decisionErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}
