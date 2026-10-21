"use client"

import { blobToWavSamples, bytesToBase64, encodeWav } from "@/lib/audio/wav"
import { apiFetch, ApiError } from "@/lib/api"
import { audioTooLong, chunkSamples } from "@/lib/meetings/audio"
import { MEETING_LIMITS } from "@/lib/meetings/limits"
import { NO_SPEECH } from "@/lib/meetings/explain"
import type { MeetingListenChoice } from "@/lib/meetings/models"
import type { MeetingSegment } from "@/lib/meetings/schema"

/** Decode an audio file and transcribe it in short pieces. */
export async function transcribeImportedAudio(input: {
  file: File
  listen: MeetingListenChoice
  onProgress: (done: number, total: number) => void
}): Promise<MeetingSegment[]> {
  if (input.file.size > MEETING_LIMITS.audioFileBytes) {
    throw new ApiError("This audio file is too large.")
  }
  let samples: Float32Array
  try {
    samples = await blobToWavSamples(input.file)
  } catch {
    throw new ApiError("This audio file could not be read. Try WAV or MP3.")
  }
  if (audioTooLong(samples.length)) {
    throw new ApiError(`Audio is limited to ${MEETING_LIMITS.audioSeconds / 60} minutes.`)
  }
  const chunks = chunkSamples(samples)
  const segments: MeetingSegment[] = []
  for (let index = 0; index < chunks.length; index++) {
    input.onProgress(index, chunks.length)
    const text = await apiFetch<{ text: string }>("/api/assistant/transcribe", {
      method: "POST",
      body: JSON.stringify({
        provider: input.listen.provider,
        model: input.listen.model,
        audio: bytesToBase64(encodeWav(chunks[index])),
        format: "wav",
      }),
    })
    const line = text.text.trim()
    if (line) {
      segments.push({
        at: index * MEETING_LIMITS.chunkSeconds,
        speaker: "others",
        text: line.slice(0, MEETING_LIMITS.segmentChars),
      })
    }
    input.onProgress(index + 1, chunks.length)
  }
  if (segments.length === 0) throw new ApiError(NO_SPEECH)
  return segments
}
