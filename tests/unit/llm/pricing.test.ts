import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { listPrice, modelPrice, resetPriceCache } from "@/lib/llm/pricing"

const OPENROUTER = "https://openrouter.ai/api/v1"

function modelsReply(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ data }) }
}

beforeEach(() => resetPriceCache())
afterEach(() => vi.unstubAllGlobals())

describe("listPrice", () => {
  it("matches the longest prefix, including dated ids", () => {
    expect(listPrice("openai", "gpt-4o-mini")).toEqual({ inputPerMTok: 0.15, outputPerMTok: 0.6, source: "list" })
    expect(listPrice("openai", "gpt-4o-2024-08-06")?.inputPerMTok).toBe(2.5)
    expect(listPrice("anthropic", "claude-sonnet-4-20250514")?.outputPerMTok).toBe(15)
    expect(listPrice("anthropic", "claude-opus-4-5-20251101")?.inputPerMTok).toBe(5)
    expect(listPrice("anthropic", "Claude-3-5-Haiku-Latest")?.inputPerMTok).toBe(0.8)
  })

  it("returns null for unknown models and other providers", () => {
    expect(listPrice("openai", "gpt-4oo")).toBeNull()
    expect(listPrice("openai", "my-fine-tune")).toBeNull()
    expect(listPrice("custom", "gpt-4o")).toBeNull()
  })
})

describe("modelPrice", () => {
  it("reads OpenRouter prices per token and caches the list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      modelsReply([
        { id: "google/gemini-2.5-flash", pricing: { prompt: "0.0000003", completion: "0.0000025" } },
        { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
        { id: "no/pricing" },
      ])
    )
    vi.stubGlobal("fetch", fetchMock)
    const creds = { apiKey: "sk-or", baseUrl: OPENROUTER }
    const price = await modelPrice("custom", "google/gemini-2.5-flash", creds)
    expect(price?.source).toBe("openrouter")
    expect(price?.inputPerMTok).toBeCloseTo(0.3)
    expect(price?.outputPerMTok).toBeCloseTo(2.5)
    expect(await modelPrice("custom", "openrouter/auto", creds)).toBeNull()
    expect(await modelPrice("custom", "no/pricing", creds)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${OPENROUTER}/models`)
  })

  it("returns null and retries later when OpenRouter fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(modelsReply([{ id: "a/b", pricing: { prompt: "0.000001", completion: "0.000002" } }]))
    vi.stubGlobal("fetch", fetchMock)
    const creds = { apiKey: "sk-or", baseUrl: OPENROUTER }
    expect(await modelPrice("custom", "a/b", creds)).toBeNull()
    expect((await modelPrice("custom", "a/b", creds))?.inputPerMTok).toBeCloseTo(1)
  })

  it("does not ask a custom endpoint that is not OpenRouter", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await modelPrice("custom", "llama", { apiKey: "k", baseUrl: "http://localhost:11434/v1" })).toBeNull()
    expect(await modelPrice("custom", "llama", { apiKey: "k" })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await modelPrice("openai", "gpt-4.1", { apiKey: "k" }))?.inputPerMTok).toBe(2)
  })
})
