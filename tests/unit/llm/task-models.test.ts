import { afterEach, describe, expect, it, vi } from "vitest"

import { listModelsWithModalities } from "@/lib/llm/list-models"
import { MODEL_TASKS, modelsForTask, resolveTaskModel, type ModelInfo } from "@/lib/llm/task-models"
import { ProviderError } from "@/lib/llm/types"

afterEach(() => {
  vi.unstubAllGlobals()
})

const audioIn: ModelInfo = { id: "google/gemini-2.5-flash", inputModalities: ["text", "audio"], outputModalities: ["text"] }
const audioOut: ModelInfo = { id: "openai/gpt-audio-mini", inputModalities: ["text"], outputModalities: ["audio"] }
const textOnly: ModelInfo = { id: "openai/gpt-4o-mini", inputModalities: ["text"], outputModalities: ["text"] }

const imageIn: ModelInfo = { id: "openai/gpt-4o", inputModalities: ["text", "image"], outputModalities: ["text"] }
const reasoner: ModelInfo = { id: "openai/o4", supportedParameters: ["reasoning", "tools"] }
const plainReason: ModelInfo = { id: "openai/gpt-4o-mini", supportedParameters: ["tools"] }

describe("modelsForTask", () => {
  it("keeps only models that take audio and give text for voice", () => {
    expect(modelsForTask("voice", [audioIn, audioOut, textOnly])).toEqual({ models: [audioIn], filtered: true })
  })

  it("returns every model unfiltered when no modality data exists", () => {
    const plain = [{ id: "a" }, { id: "b" }]
    expect(modelsForTask("voice", plain)).toEqual({ models: plain, filtered: false })
  })

  it("keeps image-in text-out models for vision", () => {
    expect(modelsForTask("vision", [imageIn, textOnly, audioIn])).toEqual({ models: [imageIn], filtered: true })
  })

  it("does not filter fast, even when modalities exist", () => {
    const models = [imageIn, textOnly]
    expect(modelsForTask("fast", models)).toEqual({ models, filtered: false })
  })

  it("filters reasoning only when some model publishes supported parameters", () => {
    expect(modelsForTask("reasoning", [textOnly, imageIn])).toEqual({
      models: [textOnly, imageIn],
      filtered: false,
    })
    expect(modelsForTask("reasoning", [reasoner, plainReason, textOnly])).toEqual({
      models: [reasoner],
      filtered: true,
    })
  })
})

describe("resolveTaskModel", () => {
  it("prefers the saved model, then the OpenRouter default", () => {
    expect(resolveTaskModel("voice", "my/model", true)).toBe("my/model")
    expect(resolveTaskModel("voice", undefined, true)).toBe(MODEL_TASKS.voice.openRouterDefault)
    expect(resolveTaskModel("voice", "  ", true)).toBe("google/gemini-2.5-flash")
  })

  it("has no default for other custom endpoints", () => {
    expect(resolveTaskModel("voice", undefined, false)).toBeUndefined()
  })
})

describe("listModelsWithModalities", () => {
  it("parses ids, names, and modalities, de-duplicated and sorted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "z/model", name: "Z", architecture: { input_modalities: ["audio"], output_modalities: ["text"] } },
          { id: "a/model" },
          { id: "z/model" },
        ],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const models = await listModelsWithModalities("https://openrouter.ai/api/v1/", "sk-or")
    expect(models).toEqual([
      { id: "a/model" },
      { id: "z/model", name: "Z", inputModalities: ["audio"], outputModalities: ["text"] },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/models")
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "Bearer sk-or" })
  })

  it("throws a ProviderError on an HTTP error or an unexpected body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    await expect(listModelsWithModalities("http://x", "")).rejects.toMatchObject({ status: 401 })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: 1 }) }))
    await expect(listModelsWithModalities("http://x", "")).rejects.toBeInstanceOf(ProviderError)
  })
})
