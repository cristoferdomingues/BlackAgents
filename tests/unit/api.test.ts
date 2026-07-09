import { describe, it, expect, vi, afterEach } from "vitest"

import { ApiError, apiFetch } from "@/lib/api"

function mockFetch(status: number, body: unknown, ok = status < 400) {
  return vi.fn(async (_input: string, _init?: RequestInit) =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("apiFetch", () => {
  it("returns data on a successful envelope", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { success: true, data: { id: 1 } }))
    await expect(apiFetch<{ id: number }>("/api/x")).resolves.toEqual({ id: 1 })
  })

  it("sends JSON content-type by default", async () => {
    const fetchMock = mockFetch(200, { success: true, data: null })
    vi.stubGlobal("fetch", fetchMock)
    await apiFetch("/api/x", { method: "POST", body: "{}" })
    const init = fetchMock.mock.calls[0][1]
    const headers = init?.headers as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("throws ApiError with the server error message on a failure envelope", async () => {
    vi.stubGlobal("fetch", mockFetch(400, { success: false, error: "Bad name" }))
    await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(ApiError)
    await expect(apiFetch("/api/x")).rejects.toThrow("Bad name")
  })

  it("throws ApiError when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("not json")
          },
        }) as unknown as Response
      )
    )
    await expect(apiFetch("/api/x")).rejects.toBeInstanceOf(ApiError)
  })

  it("falls back to a generic message when error is missing", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { success: false }))
    await expect(apiFetch("/api/x")).rejects.toThrow(/Request failed \(500\)/)
  })
})
