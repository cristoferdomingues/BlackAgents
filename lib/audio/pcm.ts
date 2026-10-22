import { WAV_SAMPLE_RATE } from "@/lib/audio/wav"

/** Root-mean-square loudness of mono samples, from 0 (silence) to about 1. */
export function audioLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

export function concatAudio(chunks: readonly Float32Array[]): Float32Array {
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const out = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Linear resample. Whisper expects {@link WAV_SAMPLE_RATE} Hz. */
export function resampleMono(input: Float32Array, fromRate: number, toRate = WAV_SAMPLE_RATE): Float32Array {
  if (input.length === 0 || fromRate === toRate) return input
  const outLength = Math.max(1, Math.round((input.length * toRate) / fromRate))
  const out = new Float32Array(outLength)
  const scale = (input.length - 1) / Math.max(1, outLength - 1)
  for (let index = 0; index < outLength; index++) {
    const position = index * scale
    const left = Math.floor(position)
    const right = Math.min(left + 1, input.length - 1)
    const mix = position - left
    const leftValue = input[left] ?? 0
    const rightValue = input[right] ?? 0
    out[index] = leftValue * (1 - mix) + rightValue * mix
  }
  return out
}
