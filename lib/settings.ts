import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { LIMITS } from "./app-config"
import { configDir } from "./config"
import { DEFAULT_CUTOFF_LEVELS, jevCutoffLevelSchema } from "./decision/cutoffs"
import { providerIdSchema } from "./llm/provider-id"

/**
 * Non-secret AI settings in ~/.black-agents/settings.json. Keys for Jev live in
 * secrets.json; this file only holds switches and limits.
 */

export const jevProviderPreferenceSchema = z.enum(["auto", "direct", "openrouter"])
export type JevProviderPreference = z.infer<typeof jevProviderPreferenceSchema>

/** Where Jev gets its OpenRouter key when the OpenRouter path is used. */
export const jevOpenRouterKeySourceSchema = z.enum(["reuse", "dedicated"])
export type JevOpenRouterKeySource = z.infer<typeof jevOpenRouterKeySourceSchema>

const jevCutoffLevelsSchema = z.object({
  artifactRouting: jevCutoffLevelSchema.default(DEFAULT_CUTOFF_LEVELS.artifactRouting),
  skillSuggest: jevCutoffLevelSchema.default(DEFAULT_CUTOFF_LEVELS.skillSuggest),
  stepGate: jevCutoffLevelSchema.default(DEFAULT_CUTOFF_LEVELS.stepGate),
  learning: jevCutoffLevelSchema.default(DEFAULT_CUTOFF_LEVELS.learning),
})

const jevCutoffLevelsPatchSchema = z
  .object({
    artifactRouting: jevCutoffLevelSchema,
    skillSuggest: jevCutoffLevelSchema,
    stepGate: jevCutoffLevelSchema,
    learning: jevCutoffLevelSchema,
  })
  .partial()

const taskModelIdSchema = z.string().trim().min(1, "Choose a model").max(200)

const taskChoiceSchema = z.object({
  provider: providerIdSchema,
  model: taskModelIdSchema,
})

/** Meeting secretary. No defaults, so saving Listen does not clear Notes. */
const meetingListenSchema = z.object({
  provider: z.enum(["openai", "custom"]),
  model: taskModelIdSchema,
})

const meetingModelsSchema = z.object({
  listen: meetingListenSchema.optional(),
  notes: taskChoiceSchema.optional(),
})

const meetingModelsPatchSchema = z.object({
  listen: meetingListenSchema.nullable().optional(),
  notes: taskChoiceSchema.nullable().optional(),
})

export const aiSettingsSchema = z.object({
  assistant: z
    .object({
      maxToolTurns: z.number().int().min(1).max(LIMITS.agentLoop.maxTurns).default(LIMITS.agentLoop.defaultMaxTurns),
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
      /** How sure Jev must be before the app uses its answer, per decision. */
      cutoffs: jevCutoffLevelsSchema.default({}),
    })
    .default({}),
  /**
   * Models by task. Voice and video stay Custom-provider model ids.
   * Chat kinds store the provider and the model together.
   */
  models: z
    .object({
      voice: taskModelIdSchema.optional(),
      video: taskModelIdSchema.optional(),
      vision: taskChoiceSchema.optional(),
      fast: taskChoiceSchema.optional(),
      reasoning: taskChoiceSchema.optional(),
      meeting: meetingModelsSchema.optional(),
      /** K0ding. When empty, the Assistant model is used. */
      coding: taskChoiceSchema.optional(),
    })
    .default({}),
  /** Desktop browser flow replay options. */
  browser: z
    .object({
      /** When true, successful LLM self-heals overwrite the saved flow step. */
      updateFlowsOnHeal: z.boolean().default(false),
      /**
       * When true, Playwright MCP starts Chromium with no window.
       * Default false so the user can see the page and log in.
       */
      headless: z.boolean().default(false),
    })
    .default({}),
})
export type AiSettings = z.infer<typeof aiSettingsSchema>

export const aiSettingsPatchSchema = z.object({
  assistant: z
    .object({
      maxToolTurns: z.number().int().min(1).max(LIMITS.agentLoop.maxTurns),
      autoApproveFileWrites: z.boolean(),
    })
    .partial()
    .optional(),
  jev: z
    .object({
      enabled: z.boolean(),
      provider: jevProviderPreferenceSchema,
      openRouterKeySource: jevOpenRouterKeySourceSchema,
      cutoffs: jevCutoffLevelsPatchSchema,
    })
    .partial()
    .optional(),
  /** A value saves it; `null` clears it. Voice and video are model ids; chat kinds are `{ provider, model }`. */
  models: z
    .object({
      voice: taskModelIdSchema.nullable(),
      video: taskModelIdSchema.nullable(),
      vision: taskChoiceSchema.nullable(),
      fast: taskChoiceSchema.nullable(),
      reasoning: taskChoiceSchema.nullable(),
      meeting: meetingModelsPatchSchema.optional(),
      coding: taskChoiceSchema.nullable(),
    })
    .partial()
    .optional(),
  browser: z
    .object({
      updateFlowsOnHeal: z.boolean(),
      headless: z.boolean(),
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
  for (const key of ["voice", "video"] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  for (const key of ["vision", "fast", "reasoning", "coding"] as const) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  if (patch.meeting) {
    const meeting = { ...next.meeting }
    if (patch.meeting.listen === null) delete meeting.listen
    else if (patch.meeting.listen) meeting.listen = patch.meeting.listen
    if (patch.meeting.notes === null) delete meeting.notes
    else if (patch.meeting.notes) meeting.notes = patch.meeting.notes
    if (meeting.listen || meeting.notes) next.meeting = meeting
    else delete next.meeting
  }
  return next
}

export async function updateAiSettings(patch: AiSettingsPatch): Promise<AiSettings> {
  const current = await readAiSettings()
  const next = aiSettingsSchema.parse({
    assistant: { ...current.assistant, ...patch.assistant },
    jev: { ...current.jev, ...patch.jev, cutoffs: { ...current.jev.cutoffs, ...patch.jev?.cutoffs } },
    models: mergeModels(current.models, patch.models),
    browser: { ...current.browser, ...patch.browser },
  })
  await fs.mkdir(configDir(), { recursive: true })
  await fs.writeFile(settingsFile(), `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}
