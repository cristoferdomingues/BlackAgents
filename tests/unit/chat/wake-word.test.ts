import { describe, expect, it } from "vitest"

import { audioLevel, resampleMono } from "@/lib/audio/pcm"
import { WAKE_LISTENING, WAKE_PREPARING } from "@/lib/chat/explain"
import { wakeMicMessage, wakePhraseHeard } from "@/lib/chat/wake-word"

describe("wakePhraseHeard", () => {
  it("hears the phrase with extra words, spaces, and punctuation", () => {
    expect(wakePhraseHeard("Hello, BlackAgents!")).toBe(true)
    expect(wakePhraseHeard("hey black agents please")).toBe(true)
    expect(wakePhraseHeard("hello black agent")).toBe(true)
    expect(wakePhraseHeard("helloblackagents")).toBe(true)
    expect(wakePhraseHeard("Oh. Hello BlackAgents, save a note.")).toBe(true)
  })

  it("ignores similar words and an empty clip", () => {
    expect(wakePhraseHeard("hello black agenda")).toBe(false)
    expect(wakePhraseHeard("black agents")).toBe(false)
    expect(wakePhraseHeard("hello there")).toBe(false)
    expect(wakePhraseHeard("   ")).toBe(false)
  })

  it("explains that listening stays on this computer", () => {
    expect(WAKE_LISTENING).toContain("Hello BlackAgents")
    expect(WAKE_LISTENING.toLowerCase()).toContain("computer")
    expect(WAKE_PREPARING.toLowerCase()).toContain("model")
    expect(wakeMicMessage("NotAllowedError")).toContain("blocked")
    expect(wakeMicMessage("NotFoundError")).toContain("microphone")
    expect(wakeMicMessage("AbortError").toLowerCase()).toContain("not sent")
  })
})

describe("pcm helpers", () => {
  it("measures silence and resamples to fewer samples", () => {
    expect(audioLevel(new Float32Array())).toBe(0)
    expect(audioLevel(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
    const same = new Float32Array([0, 1])
    expect(resampleMono(same, 16000)).toBe(same)
    const slower = resampleMono(new Float32Array([0, 0, 1, 1]), 4, 2)
    expect(Array.from(slower)).toEqual([0, 1])
  })
})
