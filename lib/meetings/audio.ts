import { WAV_SAMPLE_RATE } from "@/lib/audio/wav"

import { MEETING_LIMITS } from "./limits"

/** Cut mono samples into fixed-length pieces. The last piece can be shorter. */
export function chunkSamples(
  samples: Float32Array,
  sampleRate = WAV_SAMPLE_RATE,
  seconds = MEETING_LIMITS.chunkSeconds
): Float32Array[] {
  const size = Math.max(1, Math.floor(sampleRate * seconds))
  const chunks: Float32Array[] = []
  for (let index = 0; index < samples.length; index += size) {
    chunks.push(samples.subarray(index, Math.min(samples.length, index + size)))
  }
  return chunks
}

export function audioTooLong(sampleCount: number, sampleRate = WAV_SAMPLE_RATE): boolean {
  return sampleCount / sampleRate > MEETING_LIMITS.audioSeconds
}
