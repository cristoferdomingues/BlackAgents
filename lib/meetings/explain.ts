import { MEETING_LIMITS } from "./limits"

/** Plain-language copy for the Meetings screen. */

export const MEETINGS_TITLE = "Meetings"

export const MEETINGS_INTRO =
  "Turn a call into notes. Then save them as knowledge, or start an agent, skill, rule, or workflow from them."

export const MEETINGS_STEPS = [
  {
    title: "1. Add a meeting",
    text: "Press Start listening during a call, or paste a transcript from Meet, Zoom, Teams, or any other app.",
  },
  {
    title: "2. Read the notes",
    text: "BlackAgents writes a summary, decisions, tasks, and ideas. Notes use the language of the call.",
  },
  {
    title: "3. You decide",
    text: "Send the note to Brain to save it as knowledge, or open a draft. Nothing is saved until you say so.",
  },
] as const

export const IMPORT_EFFECT = "Reads the meeting and writes notes. Nothing is saved as knowledge yet."

export const SAVE_EFFECT =
  "Sends this note to Brain. You approve it there, then it is saved as knowledge."

export const BUILD_EFFECT = "Opens a draft in the editor. Nothing is saved until you press Save there."

export const DELETE_EFFECT = "Deletes this meeting and its transcript from this computer."

export const CONSENT_LABEL = "Everyone in the call agreed to this recording."

export const LIVE_EFFECT =
  "Records until you press Stop. Notes update during the call. Nothing is saved as knowledge until you send it to Brain."

export const LISTENING_BANNER = "Listening. Your microphone is on."

export const OTHERS_MAC = "Others are not heard on this Mac yet. Only your microphone is recorded."

export const OTHERS_ONLY_MIC = "Only your microphone is recorded."

export const PAUSE_EFFECT = "Pauses the recording. Press Resume to continue the same meeting."

export const STOP_EFFECT = "Stops the recording and writes the final notes."

export const MARK_EFFECT = "Saves a short mark at this moment, like “important”."

export const DOCX_MESSAGE = "Word files are not supported yet. Paste the text, or save it as .txt."

export const NO_SPEECH = "No speech was found in this audio."

export const LISTEN_COST =
  "Long calls cost more. The price depends on the Listen model and how long the audio is."

export const MEETING_LISTEN_HELP =
  "Turns the call audio into text. OpenAI can use whisper-1 or a newer transcribe model. Custom uses a model that accepts audio."

export const MEETING_NOTES_HELP =
  "Writes the summary, tasks, and ideas in the language of the call. Leave it empty to use the model picked in the Assistant."

const minutes = MEETING_LIMITS.audioSeconds / 60

export const LIMITS_LINE = `Text up to ${MEETING_LIMITS.transcriptChars.toLocaleString("en-US")} characters. Audio up to ${minutes} minutes. Files: txt, md, vtt, srt, mp3, wav, m4a, webm.`

export function notesLanguageLine(language: string): string {
  return `Notes are in ${language}, the language used most in the call.`
}

export function savePathLine(filePath: string): string {
  return `After you approve it in Brain, the note is saved at ${filePath}.`
}
