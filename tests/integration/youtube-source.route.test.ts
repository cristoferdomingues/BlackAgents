import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/sources/youtube/route"
import { getProviderSecret, setProviderSecret } from "@/lib/secrets"
import { updateAiSettings } from "@/lib/settings"
import { NO_CAPTIONS_MESSAGE } from "@/lib/sources/youtube"

import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

const VIDEO = "dQw4w9WgXcQ"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function mockYouTube(tracks: Array<{ baseUrl: string; languageCode: string }> = [
  { baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO}&lang=en&fmt=srv3`, languageCode: "en" },
]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.includes("/oembed")) return json({ title: "Demo video", author_name: "Demo channel" })
      if (input.includes("/youtubei/v1/player")) {
        return json({
          playabilityStatus: { status: tracks.length > 0 ? "OK" : "OK" },
          videoDetails: { title: "Demo video", author: "Demo channel" },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
        })
      }
      if (input.includes("/api/timedtext")) {
        return json({ events: [{ segs: [{ utf8: "Hello from the video" }] }] })
      }
      throw new Error(`unexpected ${input}`)
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

describe("POST /api/sources/youtube", () => {
  it("returns the title and transcript", async () => {
    mockYouTube()
    const res = await POST(
      jsonRequest("http://t/api/sources/youtube", "POST", {
        url: `https://youtu.be/${VIDEO}`,
        language: "en",
      })
    )
    expect(res.status).toBe(200)
    const jsonBody = await res.json()
    expect(jsonBody.success).toBe(true)
    expect(jsonBody.data).toMatchObject({
      videoId: VIDEO,
      title: "Demo video",
      channel: "Demo channel",
      transcript: "Hello from the video",
    })
  })

  it("rejects a link that is not a YouTube video", async () => {
    const res = await POST(
      jsonRequest("http://t/api/sources/youtube", "POST", { url: "https://example.com/watch?v=" + VIDEO })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).success).toBe(false)
  })

  it("returns 404 when the video has no captions", async () => {
    mockYouTube([])
    const res = await POST(
      jsonRequest("http://t/api/sources/youtube", "POST", { url: `https://www.youtube.com/watch?v=${VIDEO}` })
    )
    expect(res.status).toBe(404)
    const jsonBody = await res.json()
    expect(jsonBody.success).toBe(false)
    expect(jsonBody.error).toBe(NO_CAPTIONS_MESSAGE)
  })
})

describe("POST /api/sources/youtube with watch", () => {
  let env: TempEnv
  const verified = { status: "valid" as const, checkedAt: "2026-10-20T10:00:00.000Z" }
  const NOTES = "- [00:04] A slide that says Hello"

  function mockAll(options?: {
    captions?: boolean
    lengthSeconds?: string
    model?: () => Response
  }): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/chat/completions")) {
        return options?.model?.() ?? json({ choices: [{ message: { content: NOTES } }] })
      }
      if (input.includes("/oembed")) return json({ title: "Demo video", author_name: "Demo channel" })
      if (input.includes("/youtubei/v1/player")) {
        const tracks =
          options?.captions === false
            ? []
            : [{ baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO}&lang=en`, languageCode: "en" }]
        return json({
          playabilityStatus: { status: "OK" },
          videoDetails: { title: "Demo video", author: "Demo channel", lengthSeconds: options?.lengthSeconds ?? "300" },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
        })
      }
      if (input.includes("/api/timedtext")) return json({ events: [{ segs: [{ utf8: "Hello from the video" }] }] })
      throw new Error(`unexpected ${input}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  function watch(): Promise<Response> {
    return POST(jsonRequest("http://t/api/sources/youtube", "POST", { url: `https://youtu.be/${VIDEO}`, watch: true }))
  }

  async function useOpenRouter(): Promise<void> {
    await setProviderSecret("custom", { apiKey: "sk-or", baseUrl: "https://openrouter.ai/api/v1", verification: verified })
  }

  function modelCall(fetchMock: ReturnType<typeof vi.fn>): { model: string; video: unknown } | undefined {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions"))
    if (!call) return undefined
    const body = JSON.parse((call[1] as RequestInit).body as string)
    return { model: body.model, video: body.messages[0].content[1] }
  }

  beforeEach(async () => {
    env = await makeTempEnv()
  })

  afterEach(async () => {
    await env.cleanup()
  })

  it("adds video notes from the default OpenRouter video model", async () => {
    await useOpenRouter()
    const fetchMock = mockAll()
    const res = await watch()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ transcript: "Hello from the video", visualNotes: NOTES, durationSeconds: 300 })
    expect(modelCall(fetchMock)).toEqual({
      model: "google/gemini-2.5-flash",
      video: { type: "video_url", video_url: { url: `https://www.youtube.com/watch?v=${VIDEO}` } },
    })
  })

  it("uses the saved video model and works without captions", async () => {
    await useOpenRouter()
    await updateAiSettings({ models: { video: "google/gemini-2.5-pro" } })
    const fetchMock = mockAll({ captions: false })
    const res = await watch()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ transcript: "", visualNotes: NOTES })
    expect(modelCall(fetchMock)?.model).toBe("google/gemini-2.5-pro")
  })

  it("falls back to captions when the Custom provider is not set up", async () => {
    const fetchMock = mockAll()
    const res = await watch()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.transcript).toBe("Hello from the video")
    expect(body.data.visualNotes).toBeUndefined()
    expect(body.data.watchError).toMatch(/AI Providers → Custom/)
    expect(modelCall(fetchMock)).toBeUndefined()
  })

  it("asks for a video model on other endpoints, and offers paste when there are no captions", async () => {
    await setProviderSecret("custom", { apiKey: "k", baseUrl: "http://localhost:1234/v1", verification: verified })
    mockAll({ captions: false })
    const res = await watch()
    expect(res.status).toBe(412)
    const body = await res.json()
    expect(body.error).toBe(`Choose a video model in Settings → AI → Models by task. ${NO_CAPTIONS_MESSAGE}`)
  })

  it("does not watch a video that is too long", async () => {
    await useOpenRouter()
    const fetchMock = mockAll({ lengthSeconds: String(2 * 60 * 60) })
    const body = await (await watch()).json()
    expect(body.data.watchError).toMatch(/2 h 0 min/)
    expect(modelCall(fetchMock)).toBeUndefined()
  })

  it("marks the key invalid on 401 and never leaks it", async () => {
    await useOpenRouter()
    mockAll({ model: () => json({ error: { message: "bad key sk-or" } }, 401) })
    const res = await watch()
    const body = await res.json()
    expect(body.data.watchError).toBe("Watching the video failed (401)")
    expect(JSON.stringify(body)).not.toContain("sk-or")
    expect((await getProviderSecret("custom"))?.verification?.status).toBe("invalid")
  })
})
