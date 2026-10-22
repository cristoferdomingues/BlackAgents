import { z } from "zod"

/** How much of an answer is spoken. */
export const voiceStyleSchema = z.enum(["short", "normal"])
export type VoiceStyle = z.infer<typeof voiceStyleSchema>

export const voicePersonaSchema = z.object({
  /** `SpeechSynthesisVoice.voiceURI`. Empty uses the browser default. */
  voiceURI: z.string().max(300).default(""),
  /** Spoken name. Empty uses the agent name, or "Assistant". */
  name: z.string().max(40).default(""),
  /** Spoken when Talk starts. Empty uses "Hello. I am {name}." */
  greeting: z.string().max(200).default(""),
  style: voiceStyleSchema.default("short"),
})
export type VoicePersona = z.infer<typeof voicePersonaSchema>

export const DEFAULT_VOICE_PERSONA: VoicePersona = {
  voiceURI: "",
  name: "",
  greeting: "",
  style: "short",
}

/** One saved voice profile per persona. The generic assistant uses "assistant". */
export function voicePersonaKey(agentName: string | null | undefined): string {
  const id = agentName?.trim() || "assistant"
  return `black-agents:voice-persona:${id}`
}

export function parseVoicePersona(raw: string | null): VoicePersona {
  if (!raw) return DEFAULT_VOICE_PERSONA
  try {
    const parsed = voicePersonaSchema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : DEFAULT_VOICE_PERSONA
  } catch {
    return DEFAULT_VOICE_PERSONA
  }
}

/** The name used in the greeting. */
export function personaDisplayName(persona: VoicePersona, agentName?: string | null): string {
  return persona.name.trim() || agentName?.trim() || "Assistant"
}

/** What Talk says before it listens. */
export function talkGreeting(persona: VoicePersona, agentName?: string | null): string {
  const custom = persona.greeting.trim()
  if (custom) return custom
  return `Hello. I am ${personaDisplayName(persona, agentName)}.`
}
