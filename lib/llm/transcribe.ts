import { z } from "zod"

import { PROVIDER_URLS } from "@/lib/app-config"
import { openAiTranscribeModel } from "@/lib/meetings/models"

import { ProviderError, type LLMCredentials, type ProviderId } from "./types"

/**
 * Speech to text for the chat's voice fallback (when the browser has no
 * working Web Speech engine). OpenAI uses its transcription endpoint; a custom
 * OpenAI-compatible endpoint (e.g. OpenRouter) gets a chat completion with an
 * `input_audio` part. Anthropic has no speech-to-text API.
 */

export const OPENAI_TRANSCRIBE_MODEL = openAiTranscribeModel(undefined)
export const VOICE_MODEL_MISSING = "Choose a voice model in Settings → AI → Models by task"
/** About 2 minutes of 16 kHz mono 16-bit WAV, base64-encoded. */
export const MAX_AUDIO_BASE64_LENGTH = 6_000_000

export const transcribeRequestSchema = z.object({
  provider: z.string().trim().min(1),
  /** Custom provider only: the chat model that should transcribe the clip. */
  model: z.string().trim().max(200).optional(),
  audio: z
    .string()
    .min(1, "Audio is required")
    .max(MAX_AUDIO_BASE64_LENGTH, "The recording is too long")
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "Audio must be base64"),
  format: z.literal("wav"),
  /** BCP-47 hint, e.g. `pt-BR`. */
  language: z.string().trim().max(35).optional(),
})
export type TranscribeRequest = z.infer<typeof transcribeRequestSchema>

export function supportsTranscription(provider: ProviderId): boolean {
  return provider === "openai" || provider === "custom"
}

function instruction(language?: string): string {
  const hint = language ? ` The speaker most likely uses ${language}.` : ""
  return (
    "Transcribe this audio exactly as spoken, in the original language." +
    hint +
    " Reply with only the transcript text, no quotes or notes." +
    " If there is no speech, reply with an empty string."
  )
}

async function transcribeOpenAI(
  request: TranscribeRequest,
  credentials: LLMCredentials
): Promise<string> {
  const form = new FormData()
  const bytes = Buffer.from(request.audio, "base64")
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "voice.wav")
  form.append("model", openAiTranscribeModel(request.model))
  const language = request.language?.split("-")[0]?.toLowerCase()
  if (language && /^[a-z]{2}$/.test(language)) form.append("language", language)

  const res = await fetch(`${PROVIDER_URLS.openai}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
    body: form,
  })
  const json = (await res.json().catch(() => null)) as { text?: unknown } | null
  if (!res.ok) throw new ProviderError(`Transcription failed (${res.status})`, res.status)
  return typeof json?.text === "string" ? json.text.trim() : ""
}

async function transcribeCustom(
  request: TranscribeRequest,
  credentials: LLMCredentials
): Promise<string> {
  if (!credentials.baseUrl) throw new ProviderError("Custom provider requires a base URL", 400)
  if (!request.model) throw new ProviderError(VOICE_MODEL_MISSING, 412)
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (credentials.apiKey) headers.Authorization = `Bearer ${credentials.apiKey}`

  const res = await fetch(`${credentials.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: request.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction(request.language) },
            { type: "input_audio", input_audio: { data: request.audio, format: request.format } },
          ],
        },
      ],
    }),
  })
  const json = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>
  } | null
  if (!res.ok) throw new ProviderError(`Transcription failed (${res.status})`, res.status)
  const text = json?.choices?.[0]?.message?.content
  return typeof text === "string" ? text.trim() : ""
}

export function transcribeAudio(
  provider: ProviderId,
  request: TranscribeRequest,
  credentials: LLMCredentials
): Promise<string> {
  if (provider === "openai") return transcribeOpenAI(request, credentials)
  if (provider === "custom") return transcribeCustom(request, credentials)
  throw new ProviderError("Voice fallback needs an OpenAI or custom provider", 412)
}
