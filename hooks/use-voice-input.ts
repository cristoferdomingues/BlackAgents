"use client"

import * as React from "react"

import { apiFetch } from "@/lib/api"
import { blobToWavBase64 } from "@/lib/audio/wav"

/**
 * Voice to text for the chat input. `browser` uses the Web Speech API (live
 * transcript). `cloud` records the clip and sends it to
 * `/api/assistant/transcribe`, used when the browser has no speech engine or
 * cannot reach it (Brave, Firefox, Electron).
 */
export type VoiceEngine = "browser" | "cloud"
export type VoiceState = "idle" | "listening" | "transcribing"

export interface UseVoiceInputOptions {
  /** Provider used for the cloud fallback (the chat's selected provider). */
  provider: string
  /** Called with the text heard so far; `isFinal` once the clip is done. */
  onTranscript: (text: string, isFinal: boolean) => void
}

export interface UseVoiceInputReturn {
  isSupported: boolean
  state: VoiceState
  engine: VoiceEngine
  error: string | null
  start: () => Promise<void>
  stop: () => void
}

const SILENCE_MS = 1_600
const SPEECH_LEVEL = 0.15
const MAX_RECORDING_MS = 60_000
const MIN_RECORDING_MS = 500

// Web Speech API recognizer; not in TypeScript's DOM lib.
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function speechRecognitionClass(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null
  const w: Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  } = window
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function canRecordAudio(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

type Capability = VoiceEngine | "none"
const subscribeNoop = (): (() => void) => () => {}
function clientCapability(): Capability {
  if (speechRecognitionClass()) return "browser"
  if (canRecordAudio()) return "cloud"
  return "none"
}
const serverCapability = (): Capability => "none"

function micErrorMessage(err: unknown): string {
  const name = typeof err === "object" && err !== null && "name" in err ? String(err.name) : ""
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow it in your browser settings."
  }
  if (name === "NotFoundError") return "No microphone was found."
  return "Could not open the microphone."
}

export function useVoiceInput({ provider, onTranscript }: UseVoiceInputOptions): UseVoiceInputReturn {
  const capability = React.useSyncExternalStore(subscribeNoop, clientCapability, serverCapability)
  const [state, setState] = React.useState<VoiceState>("idle")
  const [fallback, setFallback] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const engine: VoiceEngine = capability === "cloud" || fallback ? "cloud" : "browser"

  const engineRef = React.useRef<VoiceEngine>(engine)
  const providerRef = React.useRef(provider)
  const onTranscriptRef = React.useRef(onTranscript)
  React.useLayoutEffect(() => {
    engineRef.current = engine
    providerRef.current = provider
    onTranscriptRef.current = onTranscript
  })

  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const audioCtxRef = React.useRef<AudioContext | null>(null)
  const frameRef = React.useRef<number | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const startedAtRef = React.useRef(0)
  const heardRef = React.useRef(false)
  const lastLoudRef = React.useRef(0)
  const unmountedRef = React.useRef(false)

  const releaseMic = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => {})
    }
    audioCtxRef.current = null
  }, [])

  const transcribe = React.useCallback(async (blob: Blob) => {
    setState("transcribing")
    try {
      const audio = await blobToWavBase64(blob)
      const data = await apiFetch<{ text: string }>("/api/assistant/transcribe", {
        method: "POST",
        body: JSON.stringify({
          provider: providerRef.current,
          audio,
          format: "wav",
          ...(navigator.language ? { language: navigator.language } : {}),
        }),
      })
      if (unmountedRef.current) return
      const text = data.text.trim()
      if (!text) setError("No speech was heard. Try again.")
      else onTranscriptRef.current(text, true)
    } catch (err) {
      if (!unmountedRef.current) {
        setError(err instanceof Error ? err.message : "Could not turn your voice into text.")
      }
    } finally {
      if (!unmountedRef.current) setState("idle")
    }
  }, [])

  /** Watch the input level so recording stops after a pause in speech. */
  const watchLevel = React.useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length
        if (Math.min(1, avg / 128) > SPEECH_LEVEL) {
          heardRef.current = true
          lastLoudRef.current = Date.now()
        }
        frameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      // Without a level meter the clip still stops at the max length or on tap.
    }
  }, [])

  const stop = React.useCallback(() => {
    const recognition = recognitionRef.current
    if (recognition) {
      try {
        recognition.stop()
      } catch {
        // already stopped
      }
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") recorder.stop()
    releaseMic()
    setState((current) => (current === "listening" ? "idle" : current))
  }, [releaseMic])

  const startRecording = React.useCallback(
    (stream: MediaStream) => {
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      heardRef.current = false
      startedAtRef.current = Date.now()
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        recorderRef.current = null
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        chunksRef.current = []
        if (Date.now() - startedAtRef.current < MIN_RECORDING_MS || blob.size === 0) {
          setError("The recording was too short. Tap the microphone and speak.")
          setState("idle")
          return
        }
        void transcribe(blob)
      }
      recorder.start()
      setState("listening")
      timerRef.current = setInterval(() => {
        const now = Date.now()
        const paused = heardRef.current && now - lastLoudRef.current > SILENCE_MS
        if (paused || now - startedAtRef.current > MAX_RECORDING_MS) stop()
      }, 200)
    },
    [stop, transcribe]
  )

  const startBrowser = React.useCallback(
    (Recognition: SpeechRecognitionConstructor) => {
      const recognition = new Recognition()
      recognitionRef.current = recognition
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = navigator.language || "en-US"
      let heard = ""
      let finished = false
      let silence: ReturnType<typeof setTimeout> | null = null

      const finish = () => {
        if (finished) return
        finished = true
        if (silence) clearTimeout(silence)
        recognition.onresult = null
        recognition.onend = null
        recognition.onerror = null
        try {
          recognition.stop()
        } catch {
          // already stopped
        }
        if (recognitionRef.current === recognition) recognitionRef.current = null
        releaseMic()
        setState("idle")
        const text = heard.trim()
        if (text) onTranscriptRef.current(text, true)
      }

      recognition.onresult = (event) => {
        let text = ""
        for (let i = 0; i < event.results.length; i++) text += event.results[i][0]?.transcript ?? ""
        heard = text.replace(/\s+/g, " ").trim()
        onTranscriptRef.current(heard, false)
        if (silence) clearTimeout(silence)
        if (heard) silence = setTimeout(finish, SILENCE_MS)
      }
      recognition.onerror = (event) => {
        // The API exists but its speech service is unreachable: record instead.
        if (event.error === "network" && canRecordAudio()) {
          finished = true
          recognition.onend = null
          recognitionRef.current = null
          setFallback(true)
          const stream = streamRef.current
          if (stream?.active) {
            startRecording(stream)
          } else {
            releaseMic()
            setState("idle")
            setError("Voice switched to recording mode. Tap the microphone again.")
          }
          return
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setError("Microphone access is blocked. Allow it in your browser settings.")
        } else if (event.error === "audio-capture") {
          setError("The microphone is busy or missing.")
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError(`Voice error: ${event.error}`)
        }
        finish()
      }
      recognition.onend = finish
      recognition.start()
      setState("listening")
    },
    [releaseMic, startRecording]
  )

  const start = React.useCallback(async () => {
    if (state !== "idle") return
    setError(null)
    const Recognition = speechRecognitionClass()
    const useCloud = engineRef.current === "cloud" || !Recognition
    if (useCloud && !canRecordAudio()) {
      setError("Voice input is not supported in this browser.")
      return
    }
    let stream: MediaStream | null = null
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        setError(micErrorMessage(err))
        return
      }
      streamRef.current = stream
      watchLevel(stream)
    }
    try {
      if (useCloud && stream) startRecording(stream)
      else if (Recognition) startBrowser(Recognition)
    } catch (err) {
      releaseMic()
      setState("idle")
      setError(err instanceof Error ? err.message : "Could not start voice input.")
    }
  }, [state, watchLevel, startRecording, startBrowser, releaseMic])

  React.useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      recognitionRef.current?.abort()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null
        recorder.stop()
      }
      releaseMic()
    }
  }, [releaseMic])

  return { isSupported: capability !== "none", state, engine, error, start, stop }
}
