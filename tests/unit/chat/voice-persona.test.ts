import { describe, expect, it } from "vitest"

import { VOICE_GREETING_HINT, VOICE_STYLE_SHORT_HINT } from "@/lib/chat/explain"
import { parseVoicePersona, personaDisplayName, talkGreeting, voicePersonaKey } from "@/lib/chat/voice-persona"

describe("voice persona", () => {
  it("greets with the saved name, or a custom line", () => {
    expect(voicePersonaKey(undefined)).toBe("black-agents:voice-persona:assistant")
    expect(voicePersonaKey("coder")).toBe("black-agents:voice-persona:coder")
    const named = parseVoicePersona(JSON.stringify({ name: "Nova" }))
    expect(personaDisplayName(named, "coder")).toBe("Nova")
    expect(talkGreeting(named, "coder")).toBe("Hello. I am Nova.")
    expect(talkGreeting(parseVoicePersona(JSON.stringify({ greeting: "Hi there." })), "coder")).toBe("Hi there.")
    expect(talkGreeting(parseVoicePersona(null), null)).toBe("Hello. I am Assistant.")
  })

  it("ignores a broken saved profile and explains the short style", () => {
    expect(parseVoicePersona("not json").style).toBe("short")
    expect(parseVoicePersona(JSON.stringify({ style: "nope", voiceURI: "v" })).voiceURI).toBe("")
    expect(VOICE_GREETING_HINT.toLowerCase()).toContain("talk")
    expect(VOICE_STYLE_SHORT_HINT.toLowerCase()).toContain("screen")
  })
})
