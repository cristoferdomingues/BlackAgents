import { afterEach, describe, expect, it, vi } from "vitest"

import {
  supportsTranscription,
  transcribeAudio,
  transcribeRequestSchema,
  type TranscribeRequest,
} from "@/lib/llm/transcribe"
import { ProviderError } from "@/lib/llm/types"

const request: TranscribeRequest = {
  provider: "openai",
  audio: "UklGRg==",
  format: "wav",
  language: "pt-BR",
}

afterEach(() => vi.unstubAllGlobals())

describe("transcribeRequestSchema", () => {
  it("requires base64 WAV audio", () => {
    expect(transcribeRequestSchema.safeParse(request).success).toBe(true)
    expect(transcribeRequestSchema.safeParse({ ...request, audio: "" }).success).toBe(false)
    expect(transcribeRequestSchema.safeParse({ ...request, audio: "%%%" }).success).toBe(false)
    expect(transcribeRequestSchema.safeParse({ ...request, format: "mp3" }).success).toBe(false)
  })
})

describe("transcribeAudio", () => {
  it("supports OpenAI and custom only", () => {
    expect(supportsTranscription("openai")).toBe(true)
    expect(supportsTranscription("custom")).toBe(true)
    expect(supportsTranscription("anthropic")).toBe(false)
  })

  it("posts multipart audio to OpenAI with the language code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: " olá mundo " }),
    })
    vi.stubGlobal("fetch", fetchMock)
    await expect(transcribeAudio("openai", request, { apiKey: "sk" })).resolves.toBe("olá mundo")
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions")
    const form = init.body as FormData
    expect(form.get("model")).toBe("whisper-1")
    expect(form.get("language")).toBe("pt")
    expect(form.get("file")).toBeInstanceOf(Blob)
  })

  it("uses a chosen OpenAI transcribe model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: "ok" }),
    })
    vi.stubGlobal("fetch", fetchMock)
    await transcribeAudio("openai", { ...request, model: "gpt-4o-transcribe" }, { apiKey: "sk" })
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData
    expect(form.get("model")).toBe("gpt-4o-transcribe")
    expect(form.get("language")).toBe("pt")
    expect(form.get("file")).toBeInstanceOf(Blob)
  })

  it("sends input_audio to a custom endpoint with the chat model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "hello" } }] }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const text = await transcribeAudio(
      "custom",
      { ...request, provider: "custom", model: "google/gemini-2.5-flash" },
      { apiKey: "k", baseUrl: "https://openrouter.ai/api/v1/" }
    )
    expect(text).toBe("hello")
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    const body = JSON.parse(String(init.body)) as {
      model: string
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.model).toBe("google/gemini-2.5-flash")
    expect(body.messages[0].content.map((p) => p.type)).toEqual(["text", "input_audio"])
  })

  it("requires a model and base URL for custom", async () => {
    await expect(
      transcribeAudio("custom", { ...request, provider: "custom" }, { apiKey: "k", baseUrl: "http://x" })
    ).rejects.toBeInstanceOf(ProviderError)
    await expect(
      transcribeAudio("custom", { ...request, model: "m" }, { apiKey: "k" })
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it("maps upstream failures to ProviderError without the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "secret" }) })
    )
    const err = await transcribeAudio("openai", request, { apiKey: "bad" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).status).toBe(401)
    expect((err as ProviderError).message).not.toContain("secret")
    expect((err as ProviderError).message).toMatch(/API key/)
  })

  it("explains how to fix audio errors without exposing the provider body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "private provider detail" } }),
      })
    )
    const err = await transcribeAudio(
      "custom",
      { ...request, provider: "custom", model: "text-only-model" },
      { apiKey: "k", baseUrl: "https://example.com/v1" }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).message).toMatch(/Listen model.*accepts audio/)
    expect((err as ProviderError).message).not.toContain("private provider detail")
  })

  it("rejects anthropic", () => {
    expect(() => transcribeAudio("anthropic", request, { apiKey: "k" })).toThrow(ProviderError)
  })
})
