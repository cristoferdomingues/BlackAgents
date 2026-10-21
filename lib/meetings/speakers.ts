import type { Meeting, MeetingSegment } from "./schema"

/** Speaker labels in the order they first spoke. */
export function uniqueSpeakers(segments: readonly { speaker: string }[]): string[] {
  const seen = new Set<string>()
  const speakers: string[] = []
  for (const segment of segments) {
    if (seen.has(segment.speaker)) continue
    seen.add(segment.speaker)
    speakers.push(segment.speaker)
  }
  return speakers
}

/** The name to show for a speaker label such as "me". */
export function speakerLabel(speaker: string, names?: Record<string, string>): string {
  return names?.[speaker] ?? speaker
}

/** Keep a rename even when later audio still arrives as "me" or "others". */
export function rememberSpeakerName(names: Record<string, string>, from: string, to: string): Record<string, string> {
  const next = { ...names }
  let linked = false
  for (const [key, value] of Object.entries(next)) {
    if (key === from || value === from) {
      next[key] = to
      linked = true
    }
  }
  if (!linked) next[from] = to
  return next
}

export function withSpeakerNames(segments: MeetingSegment[], names?: Record<string, string>): MeetingSegment[] {
  if (!names) return segments
  return segments.map((segment) => {
    const speaker = names[segment.speaker]
    return speaker ? { ...segment, speaker } : segment
  })
}

/** Apply name changes and rewrite the lines already saved. */
export function renameMeetingSpeakers(meeting: Meeting, renames: readonly { from: string; to: string }[]): Meeting {
  let names = { ...(meeting.speakerNames ?? {}) }
  let segments = meeting.segments
  for (const rename of renames) {
    if (rename.from === rename.to) continue
    names = rememberSpeakerName(names, rename.from, rename.to)
    segments = segments.map((segment) => (segment.speaker === rename.from ? { ...segment, speaker: rename.to } : segment))
  }
  return {
    ...meeting,
    ...(Object.keys(names).length > 0 ? { speakerNames: names } : {}),
    segments,
  }
}
