import { describe, expect, it } from "vitest"

import { openAiTranscribeModel, resolveListenChoice } from "@/lib/meetings/models"
import { updateAiSettings } from "@/lib/settings"
import { makeTempEnv } from "../../helpers/workspace"

describe("meeting models", () => {
  it("uses a known OpenAI transcribe model and falls back to whisper-1", () => {
    expect(openAiTranscribeModel("gpt-4o-mini-transcribe")).toBe("gpt-4o-mini-transcribe")
    expect(openAiTranscribeModel("gpt-4o")).toBe("whisper-1")
    expect(openAiTranscribeModel(undefined)).toBe("whisper-1")
  })

  it("prefers the Meeting listen model, then Voice, then whisper-1", () => {
    expect(
      resolveListenChoice({ listen: { provider: "openai", model: "gpt-4o-transcribe" }, voice: "google/gemini" })
    ).toEqual({ provider: "openai", model: "gpt-4o-transcribe" })
    expect(resolveListenChoice({ voice: "google/gemini" })).toEqual({ provider: "custom", model: "google/gemini" })
    expect(resolveListenChoice({})).toEqual({ provider: "openai", model: "whisper-1" })
  })

  it("saves Listen without clearing Notes or Voice", async () => {
    const env = await makeTempEnv()
    try {
      await updateAiSettings({
        models: {
          voice: "google/gemini",
          meeting: { notes: { provider: "openai", model: "gpt-4o-mini" } },
        },
      })
      const saved = await updateAiSettings({
        models: { meeting: { listen: { provider: "openai", model: "whisper-1" } } },
      })
      expect(saved.models.voice).toBe("google/gemini")
      expect(saved.models.meeting).toEqual({
        listen: { provider: "openai", model: "whisper-1" },
        notes: { provider: "openai", model: "gpt-4o-mini" },
      })
    } finally {
      await env.cleanup()
    }
  })
})
