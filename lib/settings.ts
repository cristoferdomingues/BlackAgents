import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { configDir } from "./config"
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

export const aiSettingsSchema = z.object({
  assistant: z
    .object({
      maxToolTurns: z.number().int().min(1).max(MAX_TURNS_LIMIT).default(DEFAULT_MAX_TURNS),
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
})
export type AiSettings = z.infer<typeof aiSettingsSchema>

export const aiSettingsPatchSchema = z.object({
  assistant: z
    .object({ maxToolTurns: z.number().int().min(1).max(MAX_TURNS_LIMIT) })
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

export async function updateAiSettings(patch: AiSettingsPatch): Promise<AiSettings> {
  const current = await readAiSettings()
  const next = aiSettingsSchema.parse({
    assistant: { ...current.assistant, ...patch.assistant },
    jev: { ...current.jev, ...patch.jev },
  })
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(settingsFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}
