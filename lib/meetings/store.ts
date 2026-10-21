import { randomUUID } from "node:crypto"

import { loadProjectScope } from "@/lib/artifacts/projects"
import { pathExists, readText, removePath, resolveInWorkspace, walkFiles, writeText } from "@/lib/fs-service"
import { ensureLocalStateIgnored } from "@/lib/workflows/store"

import { parseTranscript } from "./transcript"
import {
  meetingIdSchema,
  meetingImportSchema,
  meetingLiveSchema,
  meetingPatchSchema,
  meetingSchema,
  type Meeting,
  type MeetingImport,
} from "./schema"
import { MEETING_LIMITS } from "./limits"

export const MEETINGS_DIR = ".black-agents/meetings"

export class MeetingError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "MeetingError"
    this.status = status
  }
}

function meetingFileRel(id: string, scope?: string): string {
  if (!meetingIdSchema.safeParse(id).success) throw new MeetingError("Invalid meeting id")
  return scope ? `${MEETINGS_DIR}/${scope}/${id}.json` : `${MEETINGS_DIR}/${id}.json`
}

async function findMeetingFile(root: string, id: string): Promise<string | null> {
  if (!meetingIdSchema.safeParse(id).success) throw new MeetingError("Invalid meeting id")
  const dir = resolveInWorkspace(root, MEETINGS_DIR)
  if (!(await pathExists(dir))) return null
  const name = `${id}.json`
  for (const rel of await walkFiles(dir)) {
    const normalized = rel.split(/[/\\]/).join("/")
    if (normalized === name || normalized.endsWith(`/${name}`)) {
      return resolveInWorkspace(root, `${MEETINGS_DIR}/${normalized}`)
    }
  }
  return null
}

export async function listMeetings(root: string): Promise<Meeting[]> {
  const dir = resolveInWorkspace(root, MEETINGS_DIR)
  if (!(await pathExists(dir))) return []
  const meetings: Meeting[] = []
  for (const rel of await walkFiles(dir)) {
    if (!rel.endsWith(".json")) continue
    try {
      const parsed = meetingSchema.safeParse(JSON.parse(await readText(resolveInWorkspace(root, `${MEETINGS_DIR}/${rel}`))))
      if (parsed.success) meetings.push(parsed.data)
    } catch {
      // Skip a file that is not a meeting.
    }
  }
  return meetings.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function readMeeting(root: string, id: string): Promise<Meeting | null> {
  const abs = await findMeetingFile(root, id)
  if (!abs) return null
  const parsed = meetingSchema.safeParse(JSON.parse(await readText(abs)))
  if (!parsed.success) throw new MeetingError("This meeting file is damaged")
  return parsed.data
}

export async function saveMeeting(root: string, meeting: Meeting): Promise<Meeting> {
  const parsed = meetingSchema.safeParse(meeting)
  if (!parsed.success) throw new MeetingError(parsed.error.issues[0]?.message ?? "Invalid meeting")
  await ensureLocalStateIgnored(root)
  const rel = meetingFileRel(parsed.data.id, parsed.data.scope)
  await writeText(resolveInWorkspace(root, rel), `${JSON.stringify(parsed.data, null, 2)}\n`)
  return parsed.data
}

export async function deleteMeeting(root: string, id: string): Promise<boolean> {
  const abs = await findMeetingFile(root, id)
  if (!abs) return false
  await removePath(abs)
  return true
}

function titleFrom(input: MeetingImport, text: string): string {
  if (input.title) return input.title
  const line = text.replace(/\s+/g, " ").trim()
  return line.slice(0, 80) || "Meeting"
}

/** Store an imported transcript. Notes are written later. */
export async function importMeeting(root: string, body: unknown, now = new Date()): Promise<Meeting> {
  const parsed = meetingImportSchema.safeParse(body)
  if (!parsed.success) throw new MeetingError(parsed.error.issues[0]?.message ?? "Invalid meeting")
  const input = parsed.data
  if (input.scope) {
    const project = await loadProjectScope(root, input.scope)
    if (!project.ok) throw new MeetingError(project.error)
  }
  const segments = input.segments
    ? input.segments
    : (() => {
        const transcript = parseTranscript(input.text ?? "")
        if (!transcript.ok) throw new MeetingError(transcript.error)
        return transcript.segments
      })()
  const first = segments[0]?.text ?? "Meeting"
  const meeting: Meeting = {
    id: randomUUID(),
    title: titleFrom(input, first),
    startedAt: now.toISOString(),
    status: "processing",
    source: "import",
    ...(input.scope ? { scope: input.scope } : {}),
    segments,
  }
  return saveMeeting(root, meeting)
}

/** Start a live meeting with no transcript yet. Only one call can be open. */
export async function startLiveMeeting(root: string, body: unknown, now = new Date()): Promise<Meeting> {
  const parsed = meetingLiveSchema.safeParse(body ?? {})
  if (!parsed.success) throw new MeetingError(parsed.error.issues[0]?.message ?? "Invalid meeting")
  const input = parsed.data
  if (input.scope) {
    const project = await loadProjectScope(root, input.scope)
    if (!project.ok) throw new MeetingError(project.error)
  }
  const open = (await listMeetings(root)).find(
    (meeting) => meeting.status === "listening" || meeting.status === "paused"
  )
  if (open) throw new MeetingError("A meeting is already listening. Stop it first.", 409)
  const meeting: Meeting = {
    id: randomUUID(),
    title: input.title ?? "Live meeting",
    startedAt: now.toISOString(),
    status: "listening",
    source: "live",
    ...(input.scope ? { scope: input.scope } : {}),
    segments: [],
  }
  return saveMeeting(root, meeting)
}

/** Append transcript lines or marks, or change the live status. */
export async function patchMeeting(root: string, id: string, body: unknown): Promise<Meeting> {
  const parsed = meetingPatchSchema.safeParse(body)
  if (!parsed.success) throw new MeetingError(parsed.error.issues[0]?.message ?? "Invalid meeting")
  const current = await readMeeting(root, id)
  if (!current) throw new MeetingError("Meeting not found", 404)
  const patch = parsed.data
  const segments = [...current.segments, ...(patch.appendSegments ?? [])]
  if (segments.length > MEETING_LIMITS.segments) {
    throw new MeetingError("This meeting is too long.", 400)
  }
  const marks = [...(current.marks ?? []), ...(patch.appendMarks ?? [])]
  const next: Meeting = {
    ...current,
    segments,
    ...(marks.length > 0 ? { marks } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.endedAt ? { endedAt: patch.endedAt } : {}),
    ...(patch.notesCovered !== undefined ? { notesCovered: patch.notesCovered } : {}),
  }
  if (patch.error === null) delete next.error
  else if (patch.error) next.error = patch.error
  return saveMeeting(root, next)
}
