import { z } from "zod"

/**
 * "Models by task": jobs that need a model with special inputs or outputs,
 * separate from the chat model picked in the Assistant header. Each task says
 * which models fit it, using OpenRouter-style modality metadata.
 *
 * Chat kinds (`vision`, `fast`, `reasoning`) can be named as `model: task:<kind>`.
 * Voice stays a special job and is not a chat model.
 */

export const modelTaskSchema = z.enum(["voice", "vision", "fast", "reasoning"])
export type ModelTask = z.infer<typeof modelTaskSchema>

export const chatModelTaskSchema = z.enum(["vision", "fast", "reasoning"])
export type ChatModelTask = z.infer<typeof chatModelTaskSchema>

export interface ModelInfo {
  id: string
  name?: string
  /** Missing when the endpoint does not publish modalities. */
  inputModalities?: string[]
  outputModalities?: string[]
  /** OpenRouter `supported_parameters`, when the endpoint publishes them. */
  supportedParameters?: string[]
}

export interface ModelTaskDefinition {
  id: ModelTask
  label: string
  description: string
  /** "chat" tasks can be named in `model: task:<kind>`. */
  usage: "special" | "chat"
  /** Used for the Custom provider when its base URL is OpenRouter. */
  openRouterDefault?: string
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
    usage: "special",
    openRouterDefault: "google/gemini-2.5-flash",
    fitHint: "take audio and give text",
    fits: (model) =>
      Boolean(model.inputModalities?.includes("audio") && model.outputModalities?.includes("text")),
  },
  vision: {
    id: "vision",
    label: "Vision",
    description: "Reads images and answers in text. Name it from an agent or step as model: task:vision.",
    usage: "chat",
    fitHint: "take images and give text",
    fits: (model) =>
      Boolean(model.inputModalities?.includes("image") && model.outputModalities?.includes("text")),
  },
  fast: {
    id: "fast",
    label: "Fast",
    description: "A quicker chat model. Name it from an agent or step as model: task:fast.",
    usage: "chat",
    fitHint: "answer in text",
    fits: () => true,
  },
  reasoning: {
    id: "reasoning",
    label: "Reasoning",
    description: "A model that can reason. Name it from an agent or step as model: task:reasoning.",
    usage: "chat",
    fitHint: "reason",
    fits: (model) => Boolean(model.supportedParameters?.includes("reasoning")),
  },
}

/**
 * Models that fit a task. When no model publishes the metadata that task uses,
 * nothing is filtered. Fast has no extra filter. OpenAI and Anthropic lists
 * are skipped by the caller, because those catalogs have no modality metadata.
 */
export function modelsForTask(
  task: ModelTask,
  models: ModelInfo[]
): { models: ModelInfo[]; filtered: boolean } {
  if (task === "fast") return { models, filtered: false }
  if (task === "reasoning") {
    const known = models.some((m) => (m.supportedParameters?.length ?? 0) > 0)
    if (!known) return { models, filtered: false }
    return { models: models.filter(MODEL_TASKS.reasoning.fits), filtered: true }
  }
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
