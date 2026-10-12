import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"

import {
  filterModels,
  listOpenAICompatibleModels,
  listProviderModels,
  mergeModelLists,
} from "@/lib/llm/list-models"
import { setProviderSecret } from "@/lib/secrets"
import { ProviderError } from "@/lib/llm/types"
import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("mergeModelLists", () => {
  it("keeps first-seen order and drops duplicates", () => {
    expect(
      mergeModelLists(["gpt-4o", "gpt-4o-mini"], ["gpt-4o", "o4-mini"])
    ).toEqual(["gpt-4o", "gpt-4o-mini", "o4-mini"])
  })

  it("trims and skips empty ids", () => {
    expect(mergeModelLists(["  a  ", "", "b"], ["a"])).toEqual(["a", "b"])
  })
})

describe("filterModels", () => {
  const models = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-20250514"]

  it("returns all models when the query is empty", () => {
    expect(filterModels(models, "  ")).toEqual(models)
  })

  it("filters case-insensitively by substring", () => {
    expect(filterModels(models, "4o")).toEqual(["gpt-4o", "gpt-4o-mini"])
    expect(filterModels(models, "CLAUDE")).toEqual([
      "claude-sonnet-4-20250514",
    ])
  })
})

describe("listOpenAICompatibleModels", () => {
  it("returns sorted unique ids from a successful /models response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "z-model" }, { id: "a-model" }, { id: "a-model" }],
        }),
      })
    )

    await expect(
      listOpenAICompatibleModels("https://api.example.com/v1/", "sk-test")
    ).resolves.toEqual(["a-model", "z-model"])

    expect(fetch).toHaveBeenCalledWith("https://api.example.com/v1/models", {
      headers: { Authorization: "Bearer sk-test" },
    })
  })

  it("throws ProviderError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Invalid key" } }),
      })
    )

    await expect(
      listOpenAICompatibleModels("https://api.example.com/v1", "bad")
    ).rejects.toMatchObject({
      name: "ProviderError",
      message: "Could not list models (401)",
      status: 401,
    } satisfies Partial<ProviderError>)
  })
})

describe("listProviderModels", () => {
  let env: TempEnv
  beforeEach(async () => {
    env = await makeTempEnv()
  })
  afterEach(async () => {
    await env.cleanup()
  })

  it("returns the curated Anthropic list without a live call", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const listed = await listProviderModels("anthropic")
    expect(listed.source).toBe("static")
    expect(listed.models.map((model) => model.id)).toContain("claude-sonnet-4-20250514")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("merges a live OpenAI list onto the curated models", async () => {
    await setProviderSecret("openai", { apiKey: "sk-test" })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-live" }] }),
      })
    )
    const listed = await listProviderModels("openai")
    expect(listed.source).toBe("live")
    expect(listed.models[0]?.id).toBe("gpt-4o")
    expect(listed.models.map((model) => model.id)).toContain("gpt-live")
  })

  it("falls back to the curated OpenAI list when the live list fails", async () => {
    await setProviderSecret("openai", { apiKey: "sk-test" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }))
    const listed = await listProviderModels("openai")
    expect(listed.source).toBe("static")
    expect(listed.warning).toBe("Could not list models (503)")
    expect(listed.models.map((model) => model.id)).toContain("gpt-4o")
  })

  it("keeps supported_parameters from a custom model list", async () => {
    await setProviderSecret("custom", { apiKey: "k", baseUrl: "https://openrouter.ai/api/v1" })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "openai/o4", name: "O4", supported_parameters: ["reasoning", "tools"] }],
        }),
      })
    )
    const listed = await listProviderModels("custom")
    expect(listed.source).toBe("live")
    expect(listed.models).toEqual([
      { id: "openai/o4", name: "O4", supportedParameters: ["reasoning", "tools"] },
    ])
  })
})
