/**
 * Shared limits for meeting import. Isomorphic: the page shows the same
 * numbers the server enforces.
 */

export const MEETING_LIMITS = {
  /** Characters of pasted or file text. */
  transcriptChars: 200_000,
  segments: 2_000,
  segmentChars: 8_000,
  /** Imported audio, in seconds (2 hours). */
  audioSeconds: 2 * 60 * 60,
  /** Each piece sent to the transcription model. */
  chunkSeconds: 30,
  /** How often live notes are rewritten during a call. */
  notesEverySeconds: 120,
  audioFileBytes: 200 * 1024 * 1024,
  suggestions: 6,
  /** Transcript quoted into the notes prompt. The saved meeting keeps the rest. */
  promptChars: 80_000,
} as const
