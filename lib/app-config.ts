/**
 * Fixed app values shared across layers: provider URLs, default models,
 * limits, and timeouts. One place to read and change them.
 *
 * Isomorphic: no Node imports, because the browser reads some limits.
 * Values the user can change live in `lib/settings.ts`. Values used by one
 * module only stay in that module.
 */

const KB = 1024
const MB = 1024 * KB
const MINUTE_MS = 60_000

/** Read-only, but numbers stay `number` so callers can pass other values. */
type Frozen<T> = { readonly [K in keyof T]: T[K] extends object ? Frozen<T[K]> : T[K] }

export const PROVIDER_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  /** Base URL for the Jev (TypeSafe) client. */
  openRouter: "https://openrouter.ai/api",
} as const

export const DEFAULT_MODELS = {
  openaiTranscribe: "whisper-1",
  /** Used for the Custom provider when its base URL is OpenRouter. */
  openRouter: {
    voice: "google/gemini-2.5-flash",
    video: "google/gemini-2.5-flash",
    jev: "typesafe/jev-1.13",
  },
} as const

const limits = {
  attachments: {
    maxCount: 5,
    textBytes: 200 * KB,
    imageBytes: 5 * MB,
    pdfBytes: 10 * MB,
    totalBytes: 20 * MB,
    visualNotesBytes: 50 * KB,
  },
  youtube: {
    maxSources: 5,
    captionBytes: 2 * MB,
  },
  watchVideo: {
    /** About 540k Gemini tokens at the default frame rate. */
    maxSeconds: 30 * 60,
  },
  agentLoop: {
    defaultMaxTurns: 25,
    maxTurns: 100,
    maxToolCallsPerTurn: 20,
    /** Default total budget is `maxTurns * this`, so a longer step gets a bigger budget. */
    toolCallsPerTurnBudget: 5,
    maxToolResultChars: 12_000,
    /** Approx. 50k tokens. Leaves room for provider-specific formatting/output. */
    maxContextChars: 200_000,
  },
  workflows: {
    maxSteps: 10,
    maxStepTurns: 100,
    defaultStepTurns: 30,
    maxStepTimeoutMinutes: 240,
    defaultStepTimeoutMinutes: 30,
    maxRunTimeoutMinutes: 1_440,
    defaultRunTimeoutMinutes: 180,
    maxGateRetries: 2,
    /** How many times a review may send the work back to be fixed. */
    maxReviewRounds: 3,
    maxStepFiles: 10,
  },
}
export const LIMITS: Frozen<typeof limits> = limits

const timeouts = {
  tool: 60_000,
  approval: 15 * MINUTE_MS,
  youtubeFetch: 12_000,
  watchVideo: 3 * MINUTE_MS,
}
export const TIMEOUTS_MS: Frozen<typeof timeouts> = timeouts
