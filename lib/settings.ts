import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { configDir } from "./config"
import { providerIdSchema } from "./llm/provider-id"
import { DEFAULT_MAX_TURNS, MAX_TURNS_LIMIT } from "./runtime/agent-loop"

/**
 * Non-secret AI settings in ~/.black-agents/settings.json. Keys for Jev live in
 * secrets.json; this file only holds switches and limits.
 */

export const jevProviderPreferenceSchema = z.enum(["auto", "direct", "openrouter"])
export type JevProviderPreference = z.infer<typeof jevProviderPreferenceSchema>

/** Where Jev gets its OpenRouter key when the OpenRouter path is used. */
export const jevOpenRouterKeySourceSchema = z.enum(["reuse", "dedicated"])
export type JevOpenRouterKeySource = z.infer<typeof jevOpenRouterKeySourceSchema>

const taskModelIdSchema = z.string().trim().min(1, "Choose a model").max(200)

const taskChoiceSchema = z.object({
  provider: providerIdSchema,
  model: taskModelIdSchema,
})

export const aiSettingsSchema = z.object({
  assistant: z
    .object({
      maxToolTurns: z.number().int().min(1).max(MAX_TURNS_LIMIT).default(DEFAULT_MAX_TURNS),
      /** Generic assistant: run `fs_write` without an approval card. */
      autoApproveFileWrites: z.boolean().default(false),
    })
    .default({}),
  jev: z
    .object({
      enabled: z.boolean().default(false),
      provider: jevProviderPreferenceSchema.default("auto"),
      /**
       * `reuse` — use AI Providers → Custom key only when its base URL is OpenRouter.
       * `dedicated` — use `secrets.jev.openRouterApiKey` (Jev-only; Custom need not be OpenRouter).
       * Default `reuse` preserves the previous “share Custom OpenRouter key” behavior.
       */
      openRouterKeySource: jevOpenRouterKeySourceSchema.default("reuse"),
    })
    .default({}),
  /**
   * Models by task. Voice stays a Custom-provider model id.
   * Chat kinds store the provider and the model together.
   */
  models: z
    .object({
      voice: taskModelIdSchema.optional(),
      vision: taskChoiceSchema.optional(),
      fast: taskChoiceSchema.optional(),
      reasoning: taskChoiceSchema.optional(),
    })
    .default({}),
})
export type AiSettings = z.infer<typeof aiSettingsSchema>

export const aiSettingsPatchSchema = z.object({
  assistant: z
    .object({
      maxToolTurns: z.number().int().min(1).max(MAX_TURNS_LIMIT),
      autoApproveFileWrites: z.boolean(),
    })
    .partial()
    .optional(),
  jev: z
    .object({
      enabled: z.boolean(),
      provider: jevProviderPreferenceSchema,
      openRouterKeySource: jevOpenRouterKeySourceSchema,
    })
    .partial()
    .optional(),
  /** A value saves it; `null` clears it. Voice is a model id; chat kinds are `{ provider, model }`. */
  models: z
    .object({
      voice: taskModelIdSchema.nullable(),
      vision: taskChoiceSchema.nullable(),
      fast: taskChoiceSchema.nullable(),
      reasoning: taskChoiceSchema.nullable(),
    })
    .partial()
    .optional(),
})
export type AiSettingsPatch = z.infer<typeof aiSettingsPatchSchema>

function settingsFile(): string {
  return path.join(configDir(), "settings.json")
}

export async function readAiSettings(): Promise<AiSettings> {
  try {
    const raw = await fs.readFile(settingsFile(), "utf8")
    const parsed = aiSettingsSchema.safeParse(JSON.parse(raw) as unknown)
    if (parsed.success) return parsed.data
  } catch {
    // missing or malformed — fall back to defaults
  }
  return aiSettingsSchema.parse({})
}

function mergeModels(
  current: AiSettings["models"],
  patch: AiSettingsPatch["models"]
): AiSettings["models"] {
  const next: AiSettings["models"] = { ...current }
  if (!patch) return next
  if (patch.voice !== undefined) {
    if (patch.voice === null) delete next.voice
    else next.voice = patch.voice
  }
  for (const key of ["vision", "fast", "reasoning"] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

export async function updateAiSettings(patch: AiSettingsPatch): Promise<AiSettings> {
  const current = await readAiSettings()
  const next = aiSettingsSchema.parse({
    assistant: { ...current.assistant, ...patch.assistant },
    jev: { ...current.jev, ...patch.jev },
    models: mergeModels(current.models, patch.models),
  })
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(settingsFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}
