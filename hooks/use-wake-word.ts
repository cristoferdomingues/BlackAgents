"use client"

import * as React from "react"

import { audioLevel, concatAudio, resampleMono } from "@/lib/audio/pcm"
import { WAV_SAMPLE_RATE } from "@/lib/audio/wav"
import { WAKE_FAILED } from "@/lib/chat/explain"
import { wakeMicMessage, wakePhraseHeard } from "@/lib/chat/wake-word"

const WAKE_KEY = "black-agents:wake-word"
const listeners = new Set<() => void>()
const CLIP_SECONDS = 2.2
const KEEP_SECONDS = 0.6
const LOUD = 0.02

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

function readWake(): boolean {
  return window.localStorage.getItem(WAKE_KEY) === "1"
}

function writeWake(next: boolean): void {
  window.localStorage.setItem(WAKE_KEY, next ? "1" : "0")
  for (const listener of listeners) listener()
}

/** Whether the page should listen for "Hello BlackAgents". Kept between visits. */
export function useWakePreference(): [boolean, (next: boolean) => void] {
  const enabled = React.useSyncExternalStore(subscribe, readWake, () => false)
  return [enabled, writeWake]
}

export type WakeStatus = "off" | "preparing" | "listening" | "error"

interface FakeWakeWindow extends Window {
  __blackAgentsFakeWake?: boolean
  __wakeSay?: (text: string) => void
}

export interface WakeListener {
  /** `off` while the switch is off, even if a previous listen failed. */
  status: WakeStatus
  message: string | null
  /** Drop the microphone now, before another feature opens it. */
  release: () => void
}

/**
 * Listen locally for the wake phrase. Quiet audio is ignored, so the speech
 * model only runs when someone is talking.
 */
export function useWakeWord(options: { enabled: boolean; onWake: () => void }): WakeListener {
  const { enabled, onWake } = options
  const onWakeRef = React.useRef(onWake)
  React.useEffect(() => {
    onWakeRef.current = onWake
  }, [onWake])
  const stopRef = React.useRef<() => void>(() => {})
  const [status, setStatus] = React.useState<WakeStatus>("off")
  const [message, setMessage] = React.useState<string | null>(null)

  const release = React.useCallback(() => {
    stopRef.current()
  }, [])

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const mark = (next: WakeStatus, text: string | null = null) => {
      if (cancelled) return
      setStatus(next)
      setMessage(text)
    }

    const fake = process.env.NODE_ENV === "production" ? null : (window as FakeWakeWindow)
    if (fake?.__blackAgentsFakeWake) {
      fake.__wakeSay = (text: string) => {
        if (!cancelled && wakePhraseHeard(text)) {
          cancelled = true
          onWakeRef.current()
        }
      }
      mark("listening")
      return () => {
        cancelled = true
        delete fake.__wakeSay
      }
    }

    const pending: Float32Array[] = []
    let pendingSamples = 0
    let busy = false
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      cancelled = true
      if (timer) clearInterval(timer)
      timer = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      if (context && context.state !== "closed") void context.close().catch(() => {})
      context = null
    }
    stopRef.current = stop

    const fail = (text: string) => {
      stop()
      cancelled = false
      mark("error", text)
      cancelled = true
    }

    void (async () => {
      mark("preparing")
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const { prepareWakeModel, transcribeWakeAudio } = await import("@/lib/audio/wake-model")
        await prepareWakeModel()
        if (cancelled) {
          stop()
          return
        }
        context = new AudioContext()
        await context.resume().catch(() => {})
        const source = context.createMediaStreamSource(stream)
        const processor = context.createScriptProcessor(4096, 1, 1)
        const silent = context.createGain()
        silent.gain.value = 0
        processor.onaudioprocess = (event) => {
          const copy = new Float32Array(event.inputBuffer.getChannelData(0))
          pending.push(copy)
          pendingSamples += copy.length
        }
        source.connect(processor)
        processor.connect(silent)
        silent.connect(context.destination)
        mark("listening")
        const minSamples = Math.floor(context.sampleRate * CLIP_SECONDS)
        const keepSamples = Math.floor(context.sampleRate * KEEP_SECONDS)
        timer = setInterval(() => {
          if (busy || cancelled || pendingSamples < minSamples) return
          const merged = concatAudio(pending)
          const take = merged.subarray(0, merged.length - keepSamples)
          const rest = merged.subarray(merged.length - keepSamples)
          pending.length = 0
          pending.push(new Float32Array(rest))
          pendingSamples = rest.length
          if (audioLevel(take) < LOUD) return
          busy = true
          const audio = resampleMono(take, context?.sampleRate ?? WAV_SAMPLE_RATE)
          void transcribeWakeAudio(audio)
            .then((text) => {
              if (cancelled) return
              if (!wakePhraseHeard(text)) return
              stop()
              onWakeRef.current()
            })
            .catch(() => {
              if (!cancelled) fail(WAKE_FAILED)
            })
            .finally(() => {
              busy = false
            })
        }, 700)
      } catch (error) {
        const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : ""
        fail(name ? wakeMicMessage(name) : WAKE_FAILED)
      }
    })()

    return () => {
      stop()
    }
  }, [enabled])

  return {
    status: enabled ? status : "off",
    message: enabled ? message : null,
    release,
  }
}
