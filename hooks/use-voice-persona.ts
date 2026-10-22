"use client"

import * as React from "react"

import {
  DEFAULT_VOICE_PERSONA,
  parseVoicePersona,
  voicePersonaKey,
  type VoicePersona,
} from "@/lib/chat/voice-persona"

const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; value: VoicePersona }>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function readCached(agentName: string | null | undefined): VoicePersona {
  const key = voicePersonaKey(agentName)
  const raw = window.localStorage.getItem(key)
  const hit = cache.get(key)
  if (hit && hit.raw === raw) return hit.value
  const value = parseVoicePersona(raw)
  cache.set(key, { raw, value })
  return value
}

function writePersona(agentName: string | null | undefined, persona: VoicePersona): void {
  const key = voicePersonaKey(agentName)
  const raw = JSON.stringify(persona)
  window.localStorage.setItem(key, raw)
  cache.set(key, { raw, value: persona })
  for (const listener of listeners) listener()
}

/** The voice profile for this persona. Kept on this computer. */
export function useVoicePersona(
  agentName: string | null | undefined
): [VoicePersona, (next: VoicePersona) => void] {
  const persona = React.useSyncExternalStore(
    subscribe,
    () => readCached(agentName),
    () => DEFAULT_VOICE_PERSONA
  )
  const setPersona = React.useCallback(
    (next: VoicePersona) => writePersona(agentName, next),
    [agentName]
  )
  return [persona, setPersona]
}
