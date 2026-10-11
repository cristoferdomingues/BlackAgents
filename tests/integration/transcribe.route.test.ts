import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/assistant/transcribe/route"
import { getProviderSecret, setProviderSecret } from "@/lib/secrets"

import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv

const body = { provider: "openai", audio: "UklGRg==", format: "wav" }

function post(payload: unknown): Promise<Response> {
  return POST(jsonRequest("http://t/api/assistant/transcribe", "POST", payload))
}

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("POST /api/assistant/transcribe", () => {
  it("returns 400 for a malformed body or unknown provider", async () => {
    expect((await post({ provider: "openai" })).status).toBe(400)
    expect((await post({ ...body, audio: "%%" })).status).toBe(400)
    const unknown = await post({ ...body, provider: "gemini" })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).success).toBe(false)
  })

  it("returns 412 for anthropic and for missing or unverified credentials", async () => {
    const anthropic = await post({ ...body, provider: "anthropic" })
    expect(anthropic.status).toBe(412)
    expect((await anthropic.json()).error).toMatch(/OpenAI or custom/)

    expect((await post(body)).status).toBe(412)
    await setProviderSecret("openai", { apiKey: "sk-x" })
    expect((await post(body)).status).toBe(412)
  })

  it("returns the transcript with a verified key", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: "create a rule" }) })
    vi.stubGlobal("fetch", fetchMock)
    const res = await post(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { text: "create a rule" } })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-valid")
  })

  it("surfaces upstream errors and marks the key invalid on 401", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-old",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    const res = await post(body)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(JSON.stringify(json)).not.toContain("sk-old")
    expect((await getProviderSecret("openai"))?.verification?.status).toBe("invalid")
  })
})
