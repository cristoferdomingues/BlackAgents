import { describe, expect, it } from "vitest"

import { WAV_SAMPLE_RATE } from "@/lib/audio/wav"
import { audioTooLong, chunkSamples, concatSamples, sampleRms } from "@/lib/meetings/audio"
import { MEETING_LIMITS } from "@/lib/meetings/limits"

describe("meeting audio chunks", () => {
  it("splits samples into 30 second pieces", () => {
    const samples = new Float32Array(WAV_SAMPLE_RATE * 45)
    const chunks = chunkSamples(samples)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.length).toBe(WAV_SAMPLE_RATE * MEETING_LIMITS.chunkSeconds)
    expect(chunks[1]?.length).toBe(WAV_SAMPLE_RATE * 15)
  })

  it("joins pieces and treats silence as quiet", () => {
    const joined = concatSamples([new Float32Array([0, 0.5]), new Float32Array([-0.5])])
    expect(Array.from(joined)).toEqual([0, 0.5, -0.5])
    expect(sampleRms(new Float32Array(16))).toBe(0)
    expect(sampleRms(new Float32Array([1, -1]))).toBeGreaterThan(0.5)
  })

  it("flags audio over the limit", () => {
    expect(audioTooLong(WAV_SAMPLE_RATE * MEETING_LIMITS.audioSeconds)).toBe(false)
    expect(audioTooLong(WAV_SAMPLE_RATE * (MEETING_LIMITS.audioSeconds + 1))).toBe(true)
  })
})
