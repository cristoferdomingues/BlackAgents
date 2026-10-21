import { describe, expect, it } from "vitest"

import { parseTranscript } from "@/lib/meetings/transcript"

describe("parseTranscript", () => {
  it("reads plain paragraphs", () => {
    const parsed = parseTranscript("Hello team.\n\nWe ship Friday.")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.segments.map((segment) => segment.text)).toEqual(["Hello team.", "We ship Friday."])
    expect(parsed.segments[0]?.speaker).toBe("others")
  })

  it("reads a WebVTT cue and its speaker", () => {
    const parsed = parseTranscript(
      "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Ana>We ship Friday.\n",
      "call.vtt"
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.segments).toEqual([{ at: 1, speaker: "Ana", text: "We ship Friday." }])
  })

  it("reads an SRT cue", () => {
    const parsed = parseTranscript("1\n00:01:02,000 --> 00:01:05,000\nSee you then.\n", "call.srt")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.segments[0]).toMatchObject({ at: 62, text: "See you then." })
  })

  it("rejects an empty transcript", () => {
    expect(parseTranscript("   ").ok).toBe(false)
  })
})
