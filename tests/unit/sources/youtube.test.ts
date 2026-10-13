import { describe, expect, it } from "vitest"

import { MAX_TEXT_BYTES } from "@/lib/chat/attachments"
import {
  ensureSourcesSection,
  fetchYouTubeSource,
  limitTranscript,
  NO_CAPTIONS_MESSAGE,
  parseCaptionJson,
  parseCaptionXml,
  parseYouTubeUrl,
  pickCaptionTrack,
  YouTubeSourceError,
  type YouTubeFetcher,
} from "@/lib/sources/youtube"

const VIDEO = "dQw4w9WgXcQ"
const WATCH = `https://www.youtube.com/watch?v=${VIDEO}`

describe("parseYouTubeUrl", () => {
  it("reads the video id from common YouTube links", () => {
    const links = [
      WATCH,
      `https://youtube.com/watch?v=${VIDEO}&t=12s`,
      `https://m.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be/${VIDEO}`,
      `https://youtu.be/${VIDEO}?t=10`,
      `https://www.youtube.com/shorts/${VIDEO}`,
      `https://www.youtube.com/embed/${VIDEO}?start=4`,
      `https://www.youtube.com/live/${VIDEO}`,
      `http://www.youtube.com/watch?list=PL123&v=${VIDEO}`,
      `youtu.be/${VIDEO}`,
    ]
    for (const link of links) expect(parseYouTubeUrl(link)).toBe(VIDEO)
  })

  it("rejects hosts and paths that are not a video", () => {
    expect(parseYouTubeUrl("https://example.com/watch?v=" + VIDEO)).toBeNull()
    expect(parseYouTubeUrl("https://youtube.com.evil.com/watch?v=" + VIDEO)).toBeNull()
    expect(parseYouTubeUrl("https://www.youtube.com/playlist?list=PL123")).toBeNull()
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=short")).toBeNull()
    expect(parseYouTubeUrl("https://youtu.be/")).toBeNull()
    expect(parseYouTubeUrl("javascript:alert(1)")).toBeNull()
    expect(parseYouTubeUrl("")).toBeNull()
  })
})

describe("pickCaptionTrack", () => {
  const tracks = [
    { baseUrl: "https://www.youtube.com/api/timedtext?lang=en", languageCode: "en", kind: "asr" },
    { baseUrl: "https://www.youtube.com/api/timedtext?lang=en-manual", languageCode: "en" },
    { baseUrl: "https://www.youtube.com/api/timedtext?lang=pt", languageCode: "pt" },
  ]

  it("prefers the requested language, then a manual English track", () => {
    expect(pickCaptionTrack(tracks, "pt-BR")?.languageCode).toBe("pt")
    expect(pickCaptionTrack(tracks)?.baseUrl).toContain("en-manual")
    expect(pickCaptionTrack([])).toBeNull()
  })
})

describe("caption parsers", () => {
  it("joins json3 segments", () => {
    expect(
      parseCaptionJson({
        events: [{ segs: [{ utf8: "Hello " }, { utf8: "there" }] }, { segs: [{ utf8: "\n" }] }],
      })
    ).toBe("Hello there")
  })

  it("reads caption XML and decodes entities", () => {
    const xml = `<transcript><text start="0" dur="1">Hello &amp;#39;world</text><text start="1" dur="1">next</text></transcript>`
    expect(parseCaptionXml(xml)).toBe("Hello 'world\nnext")
    const timed = `<timedtext><body><p t="1" d="2">Line one</p></body></timedtext>`
    expect(parseCaptionXml(timed)).toBe("Line one")
  })

  it("cuts a long transcript on a character boundary", () => {
    const limited = limitTranscript("é".repeat(150_000))
    expect(limited.truncated).toBe(true)
    expect(limited.text).toContain("[Transcript cut:")
    expect(new TextEncoder().encode(limited.text).length).toBeLessThanOrEqual(MAX_TEXT_BYTES)
    expect(limitTranscript("short")).toEqual({ text: "short", truncated: false })
  })
})

describe("ensureSourcesSection", () => {
  const source = { title: "Demo [video]", url: WATCH, channel: "Ada" }

  it("appends a source list once", () => {
    const once = ensureSourcesSection("# Skill\n", [source])
    expect(once).toContain("## Sources")
    expect(once).toContain(`[Demo video](${WATCH}) (Ada)`)
    expect(ensureSourcesSection(once, [source]).match(/## Sources/g)).toHaveLength(1)
    expect(ensureSourcesSection("body", [])).toBe("body")
  })
})

describe("fetchYouTubeSource", () => {
  function json(body: unknown, status = 200): Response {
    return Response.json(body, { status })
  }

  function mockFetch(options?: {
    tracks?: Array<{ baseUrl: string; languageCode: string; kind?: string }>
    playability?: string
    caption?: (url: string) => Response
  }): YouTubeFetcher {
    const tracks = options?.tracks ?? [
      {
        baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO}&lang=en&fmt=srv3`,
        languageCode: "en",
      },
    ]
    return async (input) => {
      if (input.includes("/oembed")) return json({ title: "Demo video", author_name: "Demo channel" })
      if (input.includes("/youtubei/v1/player")) {
        return json({
          playabilityStatus: { status: options?.playability ?? "OK" },
          videoDetails: { title: "Player title", author: "Player author" },
          captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
        })
      }
      if (input.includes("/api/timedtext")) {
        return options?.caption?.(input) ?? json({ events: [{ segs: [{ utf8: "Hello from the video" }] }] })
      }
      throw new Error(`unexpected ${input}`)
    }
  }

  it("returns the title and transcript", async () => {
    const source = await fetchYouTubeSource(WATCH, { fetch: mockFetch(), language: "en" })
    expect(source).toMatchObject({
      videoId: VIDEO,
      url: WATCH,
      title: "Demo video",
      channel: "Demo channel",
      language: "en",
      transcript: "Hello from the video",
      truncated: false,
    })
  })

  it("asks for json3 captions in the requested language", async () => {
    const seen: string[] = []
    const source = await fetchYouTubeSource(`https://youtu.be/${VIDEO}`, {
      language: "pt-BR",
      fetch: mockFetch({
        tracks: [
          { baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO}&lang=en&fmt=srv3`, languageCode: "en", kind: "asr" },
          { baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO}&lang=pt&fmt=srv3`, languageCode: "pt" },
        ],
        caption: (url) => {
          seen.push(url)
          const lang = new URL(url).searchParams.get("lang")
          return json({ events: [{ segs: [{ utf8: lang === "pt" ? "Olá" : "Hello" }] }] })
        },
      }),
    })
    expect(source.transcript).toBe("Olá")
    expect(source.language).toBe("pt")
    expect(new URL(seen[0] ?? "").searchParams.get("fmt")).toBe("json3")
  })

  it("reports a missing video, missing captions, and a bad link", async () => {
    await expect(
      fetchYouTubeSource(WATCH, { fetch: mockFetch({ tracks: [], playability: "ERROR" }) })
    ).rejects.toMatchObject({ message: "Video not found", status: 404 })

    await expect(
      fetchYouTubeSource(WATCH, { fetch: mockFetch({ tracks: [] }) })
    ).rejects.toMatchObject({ message: NO_CAPTIONS_MESSAGE, status: 404 })

    const fetcher = mockFetch()
    await expect(fetchYouTubeSource("https://example.com/watch?v=" + VIDEO, { fetch: fetcher })).rejects.toBeInstanceOf(
      YouTubeSourceError
    )
  })

  it("does not follow a caption link off youtube.com", async () => {
    const calls: string[] = []
    const fetchImpl: YouTubeFetcher = async (input) => {
      calls.push(input)
      if (input.includes("/oembed")) return json({ title: "Demo video", author_name: "Ada" })
      if (input.includes("/youtubei/v1/player")) {
        return json({
          playabilityStatus: { status: "OK" },
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                { baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO}&lang=en`, languageCode: "en" },
              ],
            },
          },
        })
      }
      if (input.startsWith("https://evil.example")) throw new Error("ssrf")
      return new Response(null, { status: 302, headers: { location: "https://evil.example/caption" } })
    }
    await expect(fetchYouTubeSource(WATCH, { fetch: fetchImpl })).rejects.toMatchObject({ status: 502 })
    expect(calls.some((url) => url.includes("evil.example"))).toBe(false)
  })

  it("rejects caption hosts that are not YouTube", async () => {
    await expect(
      fetchYouTubeSource(WATCH, {
        fetch: mockFetch({
          tracks: [{ baseUrl: "https://evil.example/captions", languageCode: "en" }],
        }),
      })
    ).rejects.toMatchObject({ status: 502 })
  })

  it("turns a timeout into a clear error", async () => {
    const fetchImpl: YouTubeFetcher = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted")
          err.name = "AbortError"
          reject(err)
        })
      })
    await expect(
      fetchYouTubeSource(WATCH, { fetch: fetchImpl, timeoutMs: 15 })
    ).rejects.toMatchObject({ message: "YouTube took too long to answer", status: 502 })
  })
})
