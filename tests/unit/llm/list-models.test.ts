import { describe, it, expect, vi, afterEach } from "vitest"

import {
  filterModels,
  listOpenAICompatibleModels,
  mergeModelLists,
} from "@/lib/llm/list-models"
import { ProviderError } from "@/lib/llm/types"

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
      message: "Invalid key",
      status: 401,
    } satisfies Partial<ProviderError>)
  })
})
