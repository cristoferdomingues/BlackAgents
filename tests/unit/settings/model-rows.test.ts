import { describe, expect, it } from "vitest"

import { MODEL_ROW_IDS, modelRows, parseSavedModels, type ModelRow } from "@/lib/settings/model-rows"

function row(rows: ModelRow[], id: ModelRow["id"]): ModelRow {
  const found = rows.find((item) => item.id === id)
  if (!found) throw new Error(`missing row ${id}`)
  return found
}

describe("modelRows", () => {
  it("has one row per job, all on defaults when nothing is saved", () => {
    const rows = modelRows({})
    expect(rows.map((item) => item.id)).toEqual([...MODEL_ROW_IDS])
    expect(rows.every((item) => item.isDefault)).toBe(true)
    expect(row(rows, "voice").current).toBe("google/gemini-2.5-flash on OpenRouter")
    expect(row(rows, "vision").current).toBe("Not set")
    expect(row(rows, "coding").current).toBe("Assistant model")
    expect(row(rows, "meeting").current).toBe("Listen: whisper-1 (OpenAI) · Notes: Assistant model")
  })

  it("shows saved models with their provider", () => {
    const rows = modelRows({
      voice: "openai/gpt-4o-audio-preview",
      fast: { provider: "anthropic", model: "claude-haiku" },
      coding: { provider: "custom", model: "qwen-coder" },
      meeting: { listen: { provider: "custom", model: "microsoft/mai-transcribe-2" } },
    })
    expect(row(rows, "voice")).toMatchObject({ current: "openai/gpt-4o-audio-preview", isDefault: false })
    expect(row(rows, "fast")).toMatchObject({ current: "claude-haiku (Anthropic)", isDefault: false })
    expect(row(rows, "coding").current).toBe("qwen-coder (Custom)")
    expect(row(rows, "meeting")).toMatchObject({
      current: "Listen: microsoft/mai-transcribe-2 (Custom) · Notes: Assistant model",
      isDefault: false,
    })
    expect(row(rows, "reasoning").isDefault).toBe(true)
  })
})

describe("parseSavedModels", () => {
  it("reads the models from a settings reply", () => {
    expect(parseSavedModels({ settings: { models: { voice: "m" } } })).toEqual({ voice: "m" })
    expect(parseSavedModels({ settings: {} })).toEqual({})
  })

  it("rejects a reply with another shape", () => {
    expect(parseSavedModels(null)).toBeNull()
    expect(parseSavedModels({ settings: { models: { vision: "not-a-choice" } } })).toBeNull()
    expect(parseSavedModels({ settings: { models: { fast: { provider: "gemini", model: "x" } } } })).toBeNull()
  })
})
