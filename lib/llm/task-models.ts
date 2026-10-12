import { z } from "zod"

/**
 * "Models by task": jobs that need a model with special inputs or outputs,
 * separate from the chat model picked in the Assistant header. Each task says
 * which models fit it, using OpenRouter-style modality metadata.
 *
 * Planned growth, most specific wins: workflow step → agent `model:` →
 * workflow → Assistant default; any of them may name a task kind instead.
 */

export const modelTaskSchema = z.enum(["voice"])
export type ModelTask = z.infer<typeof modelTaskSchema>

export interface ModelInfo {
  id: string
  name?: string
  /** Missing when the endpoint does not publish modalities. */
  inputModalities?: string[]
  outputModalities?: string[]
}

export interface ModelTaskDefinition {
  id: ModelTask
  label: string
  description: string
  /** Used for the Custom provider when its base URL is OpenRouter. */
  openRouterDefault: string
  /** Completes "N models can …". */
  fitHint: string
  fits: (model: ModelInfo) => boolean
}

export const MODEL_TASKS: Record<ModelTask, ModelTaskDefinition> = {
  voice: {
    id: "voice",
    label: "Voice",
    description:
      "Turns your recorded voice into text when the browser cannot. Used with the Custom provider; OpenAI always uses whisper-1.",
    openRouterDefault: "google/gemini-2.5-flash",
    fitHint: "take audio and give text",
    fits: (model) =>
      Boolean(model.inputModalities?.includes("audio") && model.outputModalities?.includes("text")),
  },
}

/** Models that fit a task. When no model has modality metadata, nothing can be filtered. */
export function modelsForTask(
  task: ModelTask,
  models: ModelInfo[]
): { models: ModelInfo[]; filtered: boolean } {
  const known = models.some((m) => m.inputModalities && m.outputModalities)
  if (!known) return { models, filtered: false }
  return { models: models.filter(MODEL_TASKS[task].fits), filtered: true }
}

/** Saved choice first, then the OpenRouter default; `undefined` means the user must pick one. */
export function resolveTaskModel(
  task: ModelTask,
  saved: string | undefined,
  isOpenRouter: boolean
): string | undefined {
  const choice = saved?.trim()
  if (choice) return choice
  return isOpenRouter ? MODEL_TASKS[task].openRouterDefault : undefined
}
