import { z } from "zod"

import { nameSchema, projectIdSchema } from "@/lib/artifacts/schemas"
import { providerIdSchema } from "@/lib/llm/provider-id"

import { MEETING_LIMITS } from "./limits"

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "must be a date")

export const meetingIdSchema = z.string().uuid()

export const meetingSegmentSchema = z.object({
  /** Seconds from the start of the meeting. */
  at: z.number().int().min(0).max(MEETING_LIMITS.audioSeconds),
  speaker: z.string().trim().min(1).max(40).default("others"),
  text: z.string().trim().min(1).max(MEETING_LIMITS.segmentChars),
})
export type MeetingSegment = z.infer<typeof meetingSegmentSchema>

export const meetingSuggestionSchema = z.object({
  kind: z.enum(["agent", "skill", "rule", "workflow"]),
  name: nameSchema,
  reason: z.string().trim().min(1).max(300),
})
export type MeetingSuggestion = z.infer<typeof meetingSuggestionSchema>

const listItem = z.string().trim().min(1).max(500)

export const meetingNotesSchema = z.object({
  /** Name of the language used most in the call, in that language. */
  language: z.string().trim().min(2).max(40),
  summary: z.string().trim().min(1).max(4_000),
  decisions: z.array(listItem).max(30),
  actionItems: z
    .array(
      z.object({
        owner: z.string().trim().min(1).max(80).optional(),
        task: z.string().trim().min(1).max(300),
        due: z.string().trim().min(1).max(40).optional(),
      })
    )
    .max(40),
  openQuestions: z.array(listItem).max(20),
  people: z.array(z.string().trim().min(1).max(80)).max(30),
  suggestions: z.array(meetingSuggestionSchema).max(MEETING_LIMITS.suggestions),
})
export type MeetingNotes = z.infer<typeof meetingNotesSchema>

export const meetingSchema = z.object({
  id: meetingIdSchema,
  title: z.string().trim().min(1).max(120),
  startedAt: isoDate,
  status: z.enum(["processing", "ready", "failed"]),
  source: z.enum(["import", "live"]),
  /** Project id active when the meeting was created. Absent = the workspace. */
  scope: projectIdSchema.optional(),
  segments: z.array(meetingSegmentSchema).min(1).max(MEETING_LIMITS.segments),
  notes: meetingNotesSchema.optional(),
  error: z.string().trim().min(1).max(500).optional(),
  /** Set after the note is sent to the Brain inbox. */
  knowledgeProposalId: z.string().uuid().optional(),
})
export type Meeting = z.infer<typeof meetingSchema>

export const meetingImportSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    scope: projectIdSchema.optional(),
    text: z.string().trim().min(1).max(MEETING_LIMITS.transcriptChars).optional(),
    segments: z.array(meetingSegmentSchema).min(1).max(MEETING_LIMITS.segments).optional(),
  })
  .refine((value) => Boolean(value.text) || (value.segments?.length ?? 0) > 0, {
    message: "Paste a transcript or add a file",
  })
export type MeetingImport = z.infer<typeof meetingImportSchema>

export const meetingNotesRequestSchema = z.object({
  provider: providerIdSchema.optional(),
  model: z.string().trim().min(1).max(200).optional(),
})

export const meetingBuildRequestSchema = meetingNotesRequestSchema.extend({
  kind: meetingSuggestionSchema.shape.kind,
  name: nameSchema,
})
export type MeetingBuildRequest = z.infer<typeof meetingBuildRequestSchema>
