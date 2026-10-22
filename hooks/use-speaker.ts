"use client"

import * as React from "react"

import { speechChunks } from "@/lib/chat/spoken"

const READ_REPLIES_KEY = "black-agents:read-replies"
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function readReadReplies(): boolean {
  return window.localStorage.getItem(READ_REPLIES_KEY) === "1"
}

function writeReadReplies(next: boolean): void {
  window.localStorage.setItem(READ_REPLIES_KEY, next ? "1" : "0")
  for (const listener of listeners) listener()
}

/** Whether new assistant answers should be read aloud. Kept between visits. */
export function useReadReplies(): [boolean, (next: boolean) => void] {
  const enabled = React.useSyncExternalStore(subscribe, readReadReplies, () => false)
  return [enabled, writeReadReplies]
}

const subscribeNoop = (): (() => void) => () => {}

function speechSupported(): boolean {
  return typeof window.speechSynthesis?.speak === "function"
}

/** True when this browser can read text aloud. */
export function useSpeechSupported(): boolean {
  return React.useSyncExternalStore(subscribeNoop, speechSupported, () => false)
}

export interface SpeakRequest {
  onDone?: () => void
  /** A `SpeechSynthesisVoice.voiceURI`. Empty uses the browser default for this language. */
  voiceURI?: string
}

export interface Speaker {
  speaking: boolean
  speak: (text: string, request?: SpeakRequest) => void
  stop: () => void
}

function voiceFor(lang: string, voiceURI?: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  if (voiceURI) {
    const chosen = voices.find((voice) => voice.voiceURI === voiceURI)
    if (chosen) return chosen
  }
  const base = lang.toLowerCase().slice(0, 2)
  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith(base) && voice.localService) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(base))
  )
}

/** Read text with the browser voice. A new call stops the one before it. */
export function useSpeaker(): Speaker {
  const [speaking, setSpeaking] = React.useState(false)
  const token = React.useRef(0)

  const stop = React.useCallback(() => {
    token.current += 1
    if (typeof window !== "undefined") window.speechSynthesis?.cancel()
    setSpeaking(false)
  }, [])

  const speak = React.useCallback((text: string, request?: SpeakRequest) => {
    const onDone = request?.onDone
    if (typeof window === "undefined" || typeof window.speechSynthesis?.speak !== "function") return
    const chunks = speechChunks(text)
    if (chunks.length === 0) {
      onDone?.()
      return
    }
    const id = ++token.current
    window.speechSynthesis.cancel()
    window.setTimeout(() => {
      if (token.current !== id) return
      setSpeaking(true)
      try {
        const lang = navigator.language || "en-US"
        const voice = voiceFor(lang, request?.voiceURI)
        chunks.forEach((chunk, index) => {
          const utter = new SpeechSynthesisUtterance(chunk)
          utter.lang = lang
          if (voice) {
            try {
              utter.voice = voice
            } catch {
              // A listed voice can be unusable. The browser default still speaks.
            }
          }
          const done = () => {
            if (token.current !== id) return
            if (index !== chunks.length - 1) return
            setSpeaking(false)
            onDone?.()
          }
          utter.onend = done
          utter.onerror = done
          window.speechSynthesis.speak(utter)
        })
      } catch {
        if (token.current === id) setSpeaking(false)
      }
    }, 0)
  }, [])

  React.useEffect(() => {
    return () => {
      token.current += 1
      window.speechSynthesis?.cancel()
    }
  }, [])

  return { speaking, speak, stop }
}

const NO_VOICES: SpeechSynthesisVoice[] = []
let cachedVoices: SpeechSynthesisVoice[] = NO_VOICES
const voiceListeners = new Set<() => void>()

function currentVoices(): SpeechSynthesisVoice[] {
  const next = window.speechSynthesis?.getVoices() ?? NO_VOICES
  if (
    next.length === cachedVoices.length &&
    next.every((voice, index) => voice.voiceURI === cachedVoices[index]?.voiceURI)
  ) {
    return cachedVoices
  }
  cachedVoices = next.length === 0 ? NO_VOICES : next
  return cachedVoices
}

function subscribeVoices(listener: () => void): () => void {
  voiceListeners.add(listener)
  const onChange = () => {
    for (const item of voiceListeners) item()
  }
  window.speechSynthesis?.addEventListener("voiceschanged", onChange)
  return () => {
    voiceListeners.delete(listener)
    window.speechSynthesis?.removeEventListener("voiceschanged", onChange)
  }
}

/** Browser voices for the persona picker. The same array is reused until the list changes. */
export function useBrowserVoices(): SpeechSynthesisVoice[] {
  return React.useSyncExternalStore(subscribeVoices, currentVoices, () => NO_VOICES)
}
