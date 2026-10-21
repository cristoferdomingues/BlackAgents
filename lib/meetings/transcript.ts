import { MEETING_LIMITS } from "./limits"
import type { MeetingSegment } from "./schema"

export type TranscriptParse =
  | { ok: true; segments: MeetingSegment[] }
  | { ok: false; error: string }

const TIME_RE = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/

/** Seconds from a cue timestamp. `null` when the line is not a cue range. */
function cueStart(line: string): number | null {
  if (!line.includes("-->")) return null
  const match = TIME_RE.exec(line)
  if (!match) return null
  const hours = match[1] ? Number(match[1]) : 0
  const fraction = match[4].padEnd(3, "0").slice(0, 3)
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(fraction) / 1000
}

function cleanCue(raw: string): { speaker: string; text: string } | null {
  let speaker = "others"
  let text = raw.replace(/<[^>]*>/g, (tag) => {
    const voice = /^<v(?:\.[^ >]+)?\s+([^>]+)>/i.exec(tag)
    return voice ? `\u0000${voice[1].trim()}\u0000` : ""
  })
  const marked = /^\u0000([^\u0000]+)\u0000/.exec(text)
  if (marked) {
    speaker = marked[1].slice(0, 40)
    text = text.slice(marked[0].length)
  }
  text = text.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim()
  if (!marked) {
    const spoken = /^([^:\n]{1,40}):\s+(\S[\s\S]*)$/.exec(text)
    if (spoken) {
      speaker = spoken[1].trim()
      text = spoken[2].trim()
    }
  }
  if (!text) return null
  return { speaker, text: text.slice(0, MEETING_LIMITS.segmentChars) }
}

function parseCues(text: string): MeetingSegment[] {
  const blocks = text.replace(/^\uFEFF/, "").split(/\n\s*\n/)
  const segments: MeetingSegment[] = []
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) continue
    const cueIndex = lines.findIndex((line) => line.includes("-->"))
    if (cueIndex === -1) continue
    const at = cueStart(lines[cueIndex])
    if (at === null) continue
    const cleaned = cleanCue(lines.slice(cueIndex + 1).join(" "))
    if (!cleaned) continue
    segments.push({ at: Math.floor(at), speaker: cleaned.speaker, text: cleaned.text })
  }
  return segments
}

function parsePlain(text: string): MeetingSegment[] {
  const blocks = text
    .replace(/^\uFEFF/, "")
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  return blocks.slice(0, MEETING_LIMITS.segments).map((block, index) => ({
    at: index,
    speaker: "others",
    text: block.slice(0, MEETING_LIMITS.segmentChars),
  }))
}

function looksTimed(text: string, fileName?: string): boolean {
  const name = fileName?.toLowerCase() ?? ""
  if (name.endsWith(".vtt") || name.endsWith(".srt")) return true
  const head = text.trimStart().slice(0, 20)
  return head.startsWith("WEBVTT") || /^\d+\s*\n\d{2}:\d{2}/.test(text.trimStart())
}

/** Turn pasted text or a caption file into speaker lines. */
export function parseTranscript(text: string, fileName?: string): TranscriptParse {
  const raw = text.replace(/^\uFEFF/, "")
  if (raw.trim().length === 0) return { ok: false, error: "The transcript is empty." }
  if (raw.length > MEETING_LIMITS.transcriptChars) {
    return { ok: false, error: `The transcript is longer than ${MEETING_LIMITS.transcriptChars.toLocaleString("en-US")} characters.` }
  }
  const segments = looksTimed(raw, fileName) ? parseCues(raw) : parsePlain(raw)
  if (segments.length === 0) return { ok: false, error: "No spoken lines were found in this file." }
  if (segments.length > MEETING_LIMITS.segments) {
    return { ok: false, error: `This meeting has more than ${MEETING_LIMITS.segments.toLocaleString("en-US")} lines.` }
  }
  return { ok: true, segments }
}
