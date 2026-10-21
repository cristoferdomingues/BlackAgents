"use client"

import * as React from "react"

import { bytesToBase64, encodeWav } from "@/lib/audio/wav"
import { apiFetch, ApiError } from "@/lib/api"
import { concatSamples, sampleRms, SILENCE_RMS } from "@/lib/meetings/audio"
import { LISTENING_BANNER, OTHERS_MAC, OTHERS_ONLY_MIC } from "@/lib/meetings/explain"
import { MEETING_LIMITS } from "@/lib/meetings/limits"
import { resolveListenChoice, type MeetingListenChoice } from "@/lib/meetings/models"
import type { Meeting } from "@/lib/meetings/schema"

interface DesktopInfo {
  desktop: boolean
  platform: "win32" | "darwin" | "linux" | "other"
}

interface TrackCapture {
  context: AudioContext
  stream: MediaStream
  buffers: Float32Array[]
  sampleRate: number
}

export interface LiveController {
  meetingId: string | null
  /** The id currently recording. Stale "listening" meetings are not this one. */
  sessionRef: React.MutableRefObject<string | null>
  phase: "idle" | "listening" | "paused"
  banner: string | null
  othersMessage: string | null
  error: string | null
  start: (input: { title?: string; meetingId?: string; scope?: string; app?: string }) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  addMark: (text: string) => Promise<void>
}

export function subscribeCallApp(onApp: (app: string) => void): () => void {
  const bridge = (
    window as Window & { blackAgentsDesktop?: { onCallApp?: (cb: (app: string) => void) => () => void } }
  ).blackAgentsDesktop
  if (!bridge?.onCallApp) return () => undefined
  return bridge.onCallApp(onApp)
}

function setTrayListening(on: boolean): void {
  const bridge = (
    window as Window & { blackAgentsDesktop?: { setListening: (listening: boolean) => void } }
  ).blackAgentsDesktop
  bridge?.setListening(on)
}

function attach(stream: MediaStream, paused: () => boolean): TrackCapture {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const mute = context.createGain()
  mute.gain.value = 0
  const buffers: Float32Array[] = []
  processor.onaudioprocess = (event) => {
    if (paused()) return
    buffers.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  source.connect(processor)
  processor.connect(mute)
  mute.connect(context.destination)
  void context.resume().catch(() => undefined)
  return { context, stream, buffers, sampleRate: context.sampleRate }
}

function stopTrack(track: TrackCapture | null): Float32Array {
  if (!track) return new Float32Array()
  const samples = concatSamples(track.buffers.splice(0))
  track.stream.getTracks().forEach((item) => item.stop())
  void track.context.close().catch(() => undefined)
  return samples
}

async function listenChoice(): Promise<MeetingListenChoice> {
  const settings = await apiFetch<{
    settings: { models: { voice?: string; meeting?: { listen?: MeetingListenChoice } } }
  }>("/api/settings/ai")
  return resolveListenChoice({
    listen: settings.settings.models.meeting?.listen,
    voice: settings.settings.models.voice,
  })
}

async function openOthers(info: DesktopInfo): Promise<{ stream: MediaStream | null; message: string | null }> {
  if (!info.desktop || info.platform === "darwin") {
    return { stream: null, message: info.desktop && info.platform === "darwin" ? OTHERS_MAC : OTHERS_ONLY_MIC }
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop())
      return { stream: null, message: OTHERS_ONLY_MIC }
    }
    stream.getVideoTracks().forEach((track) => {
      track.enabled = false
    })
    return { stream, message: null }
  } catch {
    return { stream: null, message: OTHERS_ONLY_MIC }
  }
}

/** Record a call, save a transcript every 30 seconds, and refresh notes every 2 minutes. */
export function useLiveMeeting(onMeeting: (meeting: Meeting) => void, notesModel: () => { provider: string; model: string } | null): LiveController {
  const sessionRef = React.useRef<string | null>(null)
  const [meetingId, setMeetingId] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<"idle" | "listening" | "paused">("idle")
  const [othersMessage, setOthersMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const pausedRef = React.useRef(false)
  const tracksRef = React.useRef<{ me: TrackCapture; others: TrackCapture | null } | null>(null)
  const offsetRef = React.useRef(0)
  const segmentsRef = React.useRef(0)
  const notesAtRef = React.useRef(0)
  const timerRef = React.useRef<number | null>(null)

  const patch = React.useCallback(
    async (id: string, body: Record<string, unknown>): Promise<Meeting> => {
      const meeting = await apiFetch<Meeting>(`/api/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        keepalive: true,
      })
      onMeeting(meeting)
      return meeting
    },
    [onMeeting]
  )

  const listenRef = React.useRef<MeetingListenChoice | null>(null)

  const transcribe = React.useCallback(async (samples: Float32Array, sampleRate: number, speaker: "me" | "others", id: string, at: number): Promise<void> => {
    if (samples.length === 0 || sampleRms(samples) < SILENCE_RMS) return
    const choice = listenRef.current ?? (await listenChoice())
    listenRef.current = choice
    const text = await apiFetch<{ text: string }>("/api/assistant/transcribe", {
      method: "POST",
      body: JSON.stringify({
        provider: choice.provider,
        model: choice.model,
        audio: bytesToBase64(encodeWav(samples, sampleRate)),
        format: "wav",
      }),
    })
    const line = text.text.trim()
    if (!line) return
    const meeting = await patch(id, {
      appendSegments: [{ at, speaker, text: line.slice(0, MEETING_LIMITS.segmentChars) }],
    })
    segmentsRef.current = meeting.segments.length
    if (offsetRef.current - notesAtRef.current < MEETING_LIMITS.notesEverySeconds) return
    if (meeting.segments.length <= (meeting.notesCovered ?? 0)) return
    const model = notesModel()
    const noted = await apiFetch<Meeting>(`/api/meetings/${id}/notes`, {
      method: "POST",
      body: JSON.stringify(model?.model ? { provider: model.provider, model: model.model } : {}),
    })
    notesAtRef.current = offsetRef.current
    onMeeting(noted)
  }, [notesModel, onMeeting, patch])

  const release = React.useCallback((): { me: Float32Array; meRate: number; others: Float32Array; othersRate: number } => {
    const tracks = tracksRef.current
    tracksRef.current = null
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    const me = stopTrack(tracks?.me ?? null)
    const others = stopTrack(tracks?.others ?? null)
    return {
      me,
      meRate: tracks?.me.sampleRate ?? 16_000,
      others,
      othersRate: tracks?.others?.sampleRate ?? tracks?.me.sampleRate ?? 16_000,
    }
  }, [])

  const failSession = React.useCallback(
    async (id: string, message: string): Promise<void> => {
      release()
      pausedRef.current = false
      setPhase("idle")
      setTrayListening(false)
      setError(message)
      sessionRef.current = null
      setMeetingId(null)
      await patch(id, { status: "interrupted", error: message.slice(0, 500) }).catch(() => undefined)
    },
    [patch, release]
  )

  const flush = React.useCallback(async (): Promise<void> => {
    const id = sessionRef.current
    const tracks = tracksRef.current
    if (!id || !tracks || pausedRef.current) return
    const me = concatSamples(tracks.me.buffers.splice(0))
    const others = tracks.others ? concatSamples(tracks.others.buffers.splice(0)) : new Float32Array()
    const at = offsetRef.current
    const duration = Math.max(1, Math.round(me.length / tracks.me.sampleRate) || MEETING_LIMITS.chunkSeconds)
    offsetRef.current += duration
    try {
      await transcribe(me, tracks.me.sampleRate, "me", id, at)
      if (tracks.others) await transcribe(others, tracks.others.sampleRate, "others", id, at)
      if (offsetRef.current >= MEETING_LIMITS.audioSeconds) {
        await failSession(id, "The recording reached the 2 hour limit.")
      }
    } catch (err) {
      await failSession(id, err instanceof Error ? err.message : "The recording stopped.")
    }
  }, [failSession, transcribe])

  const start = React.useCallback(
    async (input: { title?: string; meetingId?: string; scope?: string; app?: string }): Promise<void> => {
      setError(null)
      const info = await apiFetch<DesktopInfo>("/api/desktop").catch(() => ({
        desktop: false,
        platform: "other" as const,
      }))
      let meeting: Meeting
      if (input.meetingId) {
        meeting = await patch(input.meetingId, { status: "listening", error: null })
      } else {
        meeting = await apiFetch<Meeting>("/api/meetings/live", {
          method: "POST",
          body: JSON.stringify({
            ...(input.title ? { title: input.title } : {}),
            ...(input.scope ? { scope: input.scope } : {}),
            ...(input.app ? { app: input.app } : {}),
          }),
        })
        onMeeting(meeting)
      }
      sessionRef.current = meeting.id
      setMeetingId(meeting.id)
      offsetRef.current = meeting.segments.at(-1)?.at ?? 0
      segmentsRef.current = meeting.segments.length
      notesAtRef.current = offsetRef.current
      let mic: MediaStream
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      } catch {
        await failSession(meeting.id, "The microphone is blocked. Allow it, then try again.")
        return
      }
      const others = await openOthers(info)
      setOthersMessage(others.message)
      pausedRef.current = false
      tracksRef.current = { me: attach(mic, () => pausedRef.current), others: others.stream ? attach(others.stream, () => pausedRef.current) : null }
      setPhase("listening")
      setTrayListening(true)
      timerRef.current = window.setInterval(() => void flush(), MEETING_LIMITS.chunkSeconds * 1000)
    },
    [failSession, flush, onMeeting, patch]
  )

  const pause = React.useCallback(async (): Promise<void> => {
    const id = sessionRef.current
    if (!id) return
    pausedRef.current = true
    setPhase("paused")
    await patch(id, { status: "paused" })
  }, [patch])

  const resume = React.useCallback(async (): Promise<void> => {
    const id = sessionRef.current
    if (!id) return
    pausedRef.current = false
    setPhase("listening")
    await patch(id, { status: "listening" })
  }, [patch])

  const stop = React.useCallback(async (): Promise<void> => {
    const id = sessionRef.current
    if (!id) return
    pausedRef.current = false
    const leftover = release()
    setPhase("idle")
    setTrayListening(false)
    sessionRef.current = null
    setMeetingId(null)
      const at = offsetRef.current
      try {
        await transcribe(leftover.me, leftover.meRate, "me", id, at)
        if (leftover.others.length > 0) await transcribe(leftover.others, leftover.othersRate, "others", id, at)
        const model = notesModel()
      if (segmentsRef.current > 0) {
        await apiFetch(`/api/meetings/${id}/notes`, {
          method: "POST",
          body: JSON.stringify(model?.model ? { provider: model.provider, model: model.model } : {}),
        })
      }
      await patch(id, {
        status: segmentsRef.current > 0 ? "ready" : "failed",
        endedAt: new Date().toISOString(),
        ...(segmentsRef.current > 0 ? { error: null } : { error: "No speech was found." }),
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not finish the meeting")
      await patch(id, { status: "interrupted", error: err instanceof Error ? err.message.slice(0, 500) : "Interrupted" }).catch(() => undefined)
    }
  }, [notesModel, patch, release, transcribe])

  const addMark = React.useCallback(
    async (text: string): Promise<void> => {
      const id = sessionRef.current
      const line = text.trim()
      if (!id || !line) return
      await patch(id, { appendMarks: [{ at: offsetRef.current, text: line.slice(0, 200) }] })
    },
    [patch]
  )

  React.useEffect(() => {
    const onHide = (): void => {
      const id = sessionRef.current
      if (!id) return
      void fetch(`/api/meetings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "interrupted", error: "The page closed while listening." }),
        keepalive: true,
      })
      setTrayListening(false)
    }
    window.addEventListener("pagehide", onHide)
    return () => window.removeEventListener("pagehide", onHide)
  }, [])

  return {
    meetingId,
    sessionRef,
    phase,
    banner: phase === "idle" ? null : phase === "paused" ? "Paused." : LISTENING_BANNER,
    othersMessage,
    error,
    start,
    pause,
    resume,
    stop,
    addMark,
  }
}
