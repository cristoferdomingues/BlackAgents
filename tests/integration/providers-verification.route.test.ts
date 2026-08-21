import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as saveCredential } from "@/app/api/providers/route"
import { POST as reverifyCredential } from "@/app/api/providers/reverify/route"
import { getProviderSecret, setProviderSecret } from "@/lib/secrets"
import {
  jsonRequest,
  makeTempEnv,
  type TempEnv,
} from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await env.cleanup()
})

describe("provider credential verification", () => {
  it("rejects malformed credential saves without contacting a provider", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await saveCredential(
      jsonRequest("http://t/api/providers", "POST", {
        id: "custom",
        apiKey: "",
        baseUrl: "file:///tmp/provider",
      })
    )

    expect(response.status).toBe(400)
    expect((await response.json()).success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await getProviderSecret("custom")).toBeUndefined()
  })

  it("verifies a keyless custom endpoint before saving it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal("fetch", fetchMock)

    const response = await saveCredential(
      jsonRequest("http://t/api/providers", "POST", {
        id: "custom",
        apiKey: "",
        baseUrl: "http://localhost:11434/v1",
      })
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    const custom = json.data.status.find(
      (item: { id: string }) => item.id === "custom"
    )
    expect(custom).toMatchObject({
      configured: true,
      verificationStatus: "valid",
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:11434/v1/models"
    )
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).headers
    ).not.toHaveProperty("Authorization")
  })

  it("does not replace an existing credential when verification fails", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-existing",
      verification: {
        status: "valid",
        checkedAt: "2026-08-21T10:00:00.000Z",
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 })
    )

    const response = await saveCredential(
      jsonRequest("http://t/api/providers", "POST", {
        id: "openai",
        apiKey: "sk-wrong",
      })
    )
    expect(response.status).toBe(401)
    expect((await getProviderSecret("openai"))?.apiKey).toBe("sk-existing")
    expect(
      (await getProviderSecret("openai"))?.verification?.status
    ).toBe("valid")
  })

  it("persists invalid metadata when reverification fails", async () => {
    await setProviderSecret("anthropic", {
      apiKey: "sk-revoked",
      verification: {
        status: "valid",
        checkedAt: "2026-08-21T10:00:00.000Z",
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 })
    )

    const response = await reverifyCredential(
      jsonRequest("http://t/api/providers/reverify", "POST", {
        id: "anthropic",
      })
    )
    expect(response.status).toBe(403)
    const stored = await getProviderSecret("anthropic")
    expect(stored?.verification?.status).toBe("invalid")
    expect(stored?.verification?.checkedAt).toBeTruthy()
  })

  it("rejects malformed reverification requests without contacting a provider", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await reverifyCredential(
      jsonRequest("http://t/api/providers/reverify", "POST", {
        id: "../openai",
      })
    )

    expect(response.status).toBe(400)
    expect((await response.json()).success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("requires a stored credential before reverification", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const response = await reverifyCredential(
      jsonRequest("http://t/api/providers/reverify", "POST", {
        id: "openai",
      })
    )

    expect(response.status).toBe(412)
    expect((await response.json()).success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
