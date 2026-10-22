import { z } from "zod"

import { DEFAULT_MODELS } from "@/lib/app-config"
import { providerIdSchema } from "@/lib/llm/provider-id"
import type { ProviderId } from "@/lib/llm/types"

/** Settings → Models: one table row per job that has its own model (safe for the browser). */

const choiceSchema = z.object({ provider: providerIdSchema, model: z.string() })

export const savedModelsSchema = z.object({
  voice: z.string().optional(),
  video: z.string().optional(),
  vision: choiceSchema.optional(),
  fast: choiceSchema.optional(),
  reasoning: choiceSchema.optional(),
  meeting: z
    .object({
      listen: z.object({ provider: z.enum(["openai", "custom"]), model: z.string() }).optional(),
      notes: choiceSchema.optional(),
    })
    .optional(),
  coding: choiceSchema.optional(),
})
export type SavedModels = z.infer<typeof savedModelsSchema>

const settingsResponseSchema = z.object({
  settings: z.object({ models: savedModelsSchema.default({}) }),
})

/** The saved models from a `/api/settings/ai` reply, or `null` when the reply has another shape. */
export function parseSavedModels(raw: unknown): SavedModels | null {
  const parsed = settingsResponseSchema.safeParse(raw)
  return parsed.success ? parsed.data.settings.models : null
}

export const MODEL_ROW_IDS = ["voice", "video", "vision", "fast", "reasoning", "meeting", "coding"] as const
export type ModelRowId = (typeof MODEL_ROW_IDS)[number]

export interface ModelRow {
  id: ModelRowId
  label: string
  /** What this model does, in a few words. */
  job: string
  /** The model in use now, as plain text. */
  current: string
  /** True when nothing is saved and the app uses its default. */
  isDefault: boolean
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom",
}

const ROW_TEXT: Record<ModelRowId, { label: string; job: string }> = {
  voice: { label: "Voice", job: "Turns your voice into text when the browser cannot." },
  video: { label: "Video", job: "Watches a YouTube video and writes notes." },
  vision: { label: "Vision", job: "Reads images. Use it as model: task:vision." },
  fast: { label: "Fast", job: "Quick answers. Use it as model: task:fast." },
  reasoning: { label: "Reasoning", job: "Hard problems. Use it as model: task:reasoning." },
  meeting: { label: "Meeting", job: "Hears the call, then writes the notes." },
  coding: { label: "Coding", job: "Writes code in K0ding." },
}

export const MODELS_EDIT_EFFECT = "Edit opens the choices for this job. Each choice saves on its own."

function choice(value: { provider: ProviderId; model: string }): string {
  return `${value.model} (${PROVIDER_LABELS[value.provider]})`
}

export function modelRows(models: SavedModels): ModelRow[] {
  return MODEL_ROW_IDS.map((id): ModelRow => {
    const text = ROW_TEXT[id]
    if (id === "voice" || id === "video") {
      const saved = models[id]
      return {
        id,
        ...text,
        current: saved ?? `${DEFAULT_MODELS.openRouter[id]} on OpenRouter`,
        isDefault: !saved,
      }
    }
    if (id === "meeting") {
      const listen = models.meeting?.listen
      const notes = models.meeting?.notes
      const listenText = listen ? choice(listen) : `${DEFAULT_MODELS.openaiTranscribe} (OpenAI)`
      const notesText = notes ? choice(notes) : "Assistant model"
      return {
        id,
        ...text,
        current: `Listen: ${listenText} · Notes: ${notesText}`,
        isDefault: !listen && !notes,
      }
    }
    const saved = models[id]
    if (id === "coding") {
      return { id, ...text, current: saved ? choice(saved) : "Assistant model", isDefault: !saved }
    }
    return { id, ...text, current: saved ? choice(saved) : "Not set", isDefault: !saved }
  })
}
