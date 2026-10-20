import { writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PUT } from "@/app/api/settings/ai/route"
import { GET } from "@/app/api/settings/ai/models/route"
import { setProviderSecret } from "@/lib/secrets"
import { readAiSettings } from "@/lib/settings"

import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

function get(task: string): Promise<Response> {
  return GET(new Request(`http://t/api/settings/ai/models?task=${task}`))
}

const openRouterModels = {
  data: [
    { id: "google/gemini-2.5-flash", architecture: { input_modalities: ["text", "audio"], output_modalities: ["text"] } },
    { id: "openai/gpt-audio-mini", architecture: { input_modalities: ["text"], output_modalities: ["audio"] } },
  ],
}

describe("GET /api/settings/ai/models", () => {
  it("returns 400 for an unknown task", async () => {
    expect((await get("images")).status).toBe(400)
  })

  it("has no models and no default without a Custom provider", async () => {
    const body = await (await get("voice")).json()
    expect(body.data).toMatchObject({
      saved: null,
      defaultModel: null,
      effective: null,
      custom: { configured: false, isOpenRouter: false },
      models: [],
    })
  })

  it("lists only audio-in models from OpenRouter and uses the default", async () => {
    await setProviderSecret("custom", { apiKey: "sk-or-secret", baseUrl: "https://openrouter.ai/api/v1" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => openRouterModels }))
    const body = await (await get("voice")).json()
    expect(body.data).toMatchObject({
      defaultModel: "google/gemini-2.5-flash",
      effective: "google/gemini-2.5-flash",
      custom: { configured: true, isOpenRouter: true },
      models: [{ id: "google/gemini-2.5-flash" }],
      filtered: true,
    })
    expect(JSON.stringify(body)).not.toContain("sk-or-secret")
  })

  it("still answers with a warning when the model list fails", async () => {
    await setProviderSecret("custom", { apiKey: "k", baseUrl: "http://localhost:9999/v1" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    const body = await (await get("voice")).json()
    expect(body.success).toBe(true)
    expect(body.data).toMatchObject({ models: [], filtered: false, defaultModel: null })
    expect(body.data.warning).toMatch(/500/)
  })
})

describe("PUT /api/settings/ai models", () => {
  it("saves a voice model and clears it with null", async () => {
    const put = (models: unknown) => PUT(jsonRequest("http://t/api/settings/ai", "PUT", { models }))
    expect((await put({ voice: "openai/gpt-4o-audio-preview" })).status).toBe(200)
    expect((await readAiSettings()).models.voice).toBe("openai/gpt-4o-audio-preview")

    await setProviderSecret("custom", { apiKey: "k", baseUrl: "https://openrouter.ai/api/v1" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => openRouterModels }))
    expect((await (await get("voice")).json()).data.effective).toBe("openai/gpt-4o-audio-preview")

    await put({ voice: null })
    expect((await readAiSettings()).models).toEqual({})
  })

  it("saves a video model and lists only video-in models", async () => {
    const put = (models: unknown) => PUT(jsonRequest("http://t/api/settings/ai", "PUT", { models }))
    await setProviderSecret("custom", { apiKey: "k", baseUrl: "https://openrouter.ai/api/v1" })
    const videoModels = {
      data: [
        { id: "google/gemini-2.5-pro", architecture: { input_modalities: ["text", "video"], output_modalities: ["text"] } },
        { id: "openai/gpt-4o", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
      ],
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => videoModels }))
    expect((await (await get("video")).json()).data).toMatchObject({
      effective: "google/gemini-2.5-flash",
      models: [{ id: "google/gemini-2.5-pro" }],
      filtered: true,
    })

    expect((await put({ video: "google/gemini-2.5-pro" })).status).toBe(200)
    expect((await readAiSettings()).models.video).toBe("google/gemini-2.5-pro")
    expect((await (await get("video")).json()).data.effective).toBe("google/gemini-2.5-pro")
    await put({ video: null })
    expect((await readAiSettings()).models).toEqual({})
  })

  it("saves and clears a chat-kind choice and still reads an old settings file", async () => {
    await writeFile(
      path.join(env.configDir, "settings.json"),
      JSON.stringify({ models: { voice: "google/gemini-2.5-flash" } }),
      "utf8"
    )
    expect((await readAiSettings()).models).toEqual({ voice: "google/gemini-2.5-flash" })

    const put = (models: unknown) => PUT(jsonRequest("http://t/api/settings/ai", "PUT", { models }))
    expect((await put({ vision: { provider: "openai", model: "gpt-4o" } })).status).toBe(200)
    expect((await readAiSettings()).models.vision).toEqual({ provider: "openai", model: "gpt-4o" })
    expect((await readAiSettings()).models.voice).toBe("google/gemini-2.5-flash")

    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-extra" }] }),
      })
    )
    const listed = await (await GET(new Request("http://t/api/settings/ai/models?task=vision"))).json()
    expect(listed.data).toMatchObject({
      provider: "openai",
      saved: { provider: "openai", model: "gpt-4o" },
      effective: "gpt-4o",
      filtered: false,
    })
    expect(listed.data.providers).toEqual(
      expect.arrayContaining([{ id: "openai", label: "OpenAI", verified: true }])
    )
    expect(listed.data.models).toContainEqual({ id: "gpt-4o" })
    expect(JSON.stringify(listed)).not.toContain("sk-valid")

    const switched = await (
      await GET(new Request("http://t/api/settings/ai/models?task=vision&provider=anthropic"))
    ).json()
    expect(switched.data.provider).toBe("anthropic")
    expect(switched.data.models.map((model: { id: string }) => model.id)).toContain("claude-sonnet-4-20250514")

    await put({ vision: null })
    expect((await readAiSettings()).models.vision).toBeUndefined()
    const cleared = await (await get("vision")).json()
    expect(cleared.data.saved).toBeNull()
    expect(cleared.data.effective).toBeNull()
  })

  it("filters a custom vision list and leaves fast unfiltered", async () => {
    await setProviderSecret("custom", { apiKey: "sk-or-secret", baseUrl: "https://openrouter.ai/api/v1" })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-4o", architecture: { input_modalities: ["image", "text"], output_modalities: ["text"] } },
            { id: "meta/llama", architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
          ],
        }),
      })
    )
    const vision = await (await GET(new Request("http://t/api/settings/ai/models?task=vision&provider=custom"))).json()
    expect(vision.data).toMatchObject({
      provider: "custom",
      filtered: true,
      models: [{ id: "openai/gpt-4o" }],
    })
    const fast = await (await GET(new Request("http://t/api/settings/ai/models?task=fast&provider=custom"))).json()
    expect(fast.data.filtered).toBe(false)
    expect(fast.data.models).toHaveLength(2)

    const reasoning = await (
      await GET(new Request("http://t/api/settings/ai/models?task=reasoning&provider=custom"))
    ).json()
    expect(reasoning.data.filtered).toBe(false)

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/o4", supported_parameters: ["reasoning"] },
            { id: "meta/llama", supported_parameters: ["tools"] },
          ],
        }),
      })
    )
    const filtered = await (
      await GET(new Request("http://t/api/settings/ai/models?task=reasoning&provider=custom"))
    ).json()
    expect(filtered.data.filtered).toBe(true)
    expect(filtered.data.models).toEqual([{ id: "openai/o4" }])
    expect(JSON.stringify(filtered)).not.toContain("sk-or-secret")
  })

  it("saves each chat kind on its own and rejects a choice with no provider", async () => {
    const put = (models: unknown) => PUT(jsonRequest("http://t/api/settings/ai", "PUT", { models }))
    expect((await put({ vision: { model: "gpt-4o" } })).status).toBe(400)
    expect((await put({ fast: { provider: "openai", model: "gpt-4o-mini" } })).status).toBe(200)
    expect((await put({ reasoning: { provider: "anthropic", model: "claude-sonnet-4-20250514" } })).status).toBe(200)
    expect((await readAiSettings()).models.fast).toEqual({ provider: "openai", model: "gpt-4o-mini" })
    expect((await readAiSettings()).models.reasoning).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    })
    await put({ fast: null })
    expect((await readAiSettings()).models.fast).toBeUndefined()
    expect((await readAiSettings()).models.reasoning?.model).toBe("claude-sonnet-4-20250514")

    const unknown = await GET(new Request("http://t/api/settings/ai/models?task=vision&provider=gemini"))
    expect(unknown.status).toBe(400)
  })

  it("rejects an empty model id", async () => {
    const res = await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { models: { voice: " " } }))
    expect(res.status).toBe(400)
  })
})
