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

/** Join recorded pieces into one buffer. */
export function concatSamples(parts: readonly Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Loudness from 0 (silence) to about 1. */
export function sampleRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

export const SILENCE_RMS = 0.01
