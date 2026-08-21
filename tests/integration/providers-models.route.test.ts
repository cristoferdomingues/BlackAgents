import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { GET } from "@/app/api/providers/models/route"
import { setProviderSecret } from "@/lib/secrets"
import { makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await env.cleanup()
})

describe("GET /api/providers/models", () => {
  it("rejects an unknown provider", async () => {
    const res = await GET(new Request("http://t/api/providers/models?id=gemini"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it("returns curated static models when no live credentials exist", async () => {
    const res = await GET(
      new Request("http://t/api/providers/models?id=anthropic")
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.source).toBe("static")
    expect(json.data.models).toContain("claude-sonnet-4-20250514")
  })

  it("merges a live OpenAI-compatible list on top of curated models", async () => {
    await setProviderSecret("openai", { apiKey: "sk-test-1234" })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-4o" }, { id: "gpt-new-live" }],
        }),
      })
    )

    const res = await GET(
      new Request("http://t/api/providers/models?id=openai")
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.source).toBe("live")
    expect(json.data.models[0]).toBe("gpt-4o")
    expect(json.data.models).toContain("gpt-new-live")
    expect(json.data.models).toContain("gpt-4o-mini")
  })

  it("falls back to static models when the live list fails", async () => {
    await setProviderSecret("custom", {
      apiKey: "k",
      baseUrl: "http://localhost:11434/v1",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "boom" } }),
      })
    )

    const res = await GET(
      new Request("http://t/api/providers/models?id=custom")
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.source).toBe("static")
    expect(json.data.models).toEqual([])
    expect(json.data.warning).toBe("Could not list models (500)")
  })
})
