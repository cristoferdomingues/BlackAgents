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

  it("rejects an empty model id", async () => {
    const res = await PUT(jsonRequest("http://t/api/settings/ai", "PUT", { models: { voice: " " } }))
    expect(res.status).toBe(400)
  })
})
