/**
 * The short chime played when a tool call needs the user's approval.
 * Browser only; every step fails silently (no audio device, autoplay block).
 */

export const APPROVAL_SOUND_KEY = "black-agents:approval-sound"

const NOTES_HZ = [880, 1318.5]
const NOTE_SECONDS = 0.16
const VOLUME = 0.15

const alerted = new Set<string>()

/** True the first time an approval id is seen, so remounts and polling stay quiet. */
export function claimApprovalAlert(id: string): boolean {
  if (alerted.has(id)) return false
  alerted.add(id)
  return true
}

/** Test helper: forget which approvals already played. */
export function resetApprovalAlerts(): void {
  alerted.clear()
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function isApprovalSoundMuted(): boolean {
  try {
    return storage()?.getItem(APPROVAL_SOUND_KEY) === "off"
  } catch {
    return false
  }
}

export function setApprovalSoundMuted(muted: boolean): void {
  try {
    storage()?.setItem(APPROVAL_SOUND_KEY, muted ? "off" : "on")
  } catch {
    // Private mode: the choice lasts until reload.
  }
}

type AudioContextCtor = new () => AudioContext

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ??
    null
  )
}

let shared: AudioContext | null = null

/** Two rising notes with a soft envelope. Returns false when nothing played. */
export async function playApprovalChime(
  createContext: (() => AudioContext) | null = null
): Promise<boolean> {
  try {
    if (!shared || shared.state === "closed") {
      const Ctor = audioContextCtor()
      shared = createContext ? createContext() : Ctor ? new Ctor() : null
    }
    const ctx = shared
    if (!ctx) return false
    if (ctx.state === "suspended") await ctx.resume()
    if (ctx.state !== "running") return false

    const start = ctx.currentTime
    NOTES_HZ.forEach((frequency, i) => {
      const at = start + i * NOTE_SECONDS
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.setValueAtTime(frequency, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS * 1.6)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + NOTE_SECONDS * 1.6)
    })
    return true
  } catch {
    return false
  }
}

/** Test helper: drop the shared audio context. */
export function resetApprovalAudio(): void {
  shared = null
}

/** Play once per approval id, unless the user muted the sound. */
export async function alertForApproval(
  id: string,
  createContext?: () => AudioContext
): Promise<boolean> {
  if (!claimApprovalAlert(id)) return false
  if (isApprovalSoundMuted()) return false
  return playApprovalChime(createContext ?? null)
}
