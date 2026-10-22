import { DEFAULT_MODELS } from "@/lib/app-config"
import type { ProviderId } from "@/lib/llm/types"

/**
 * The Meeting task in Settings → Models.
 * Listen turns call audio into text. Notes writes the summary and suggestions.
 */

export const OPENAI_LISTEN_MODELS = [
  "whisper-1",
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
] as const

export type OpenAiListenModel = (typeof OPENAI_LISTEN_MODELS)[number]

export function isOpenAiListenModel(model: string): model is OpenAiListenModel {
  return (OPENAI_LISTEN_MODELS as readonly string[]).includes(model)
}

/** Use a known OpenAI transcription model, or whisper-1 when the id is missing or unknown. */
export function openAiTranscribeModel(requested: string | undefined): string {
  if (requested && isOpenAiListenModel(requested)) return requested
  return DEFAULT_MODELS.openaiTranscribe
}

export interface MeetingListenChoice {
  provider: "openai" | "custom"
  model: string
}

export interface MeetingNotesChoice {
  provider: ProviderId
  model: string
}

/**
 * Listen model: the Meeting choice, else the Voice model on Custom,
 * else OpenAI whisper-1.
 */
export function resolveListenChoice(input: {
  listen?: MeetingListenChoice
  voice?: string
}): MeetingListenChoice {
  if (input.listen?.model.trim()) return input.listen
  const voice = input.voice?.trim()
  if (voice) return { provider: "custom", model: voice }
  return { provider: "openai", model: DEFAULT_MODELS.openaiTranscribe }
}
