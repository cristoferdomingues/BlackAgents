import { afterEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/sources/youtube/route"
import { NO_CAPTIONS_MESSAGE } from "@/lib/sources/youtube"

import { jsonRequest } from "../helpers/workspace"

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
