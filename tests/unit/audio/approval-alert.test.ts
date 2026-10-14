import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  APPROVAL_SOUND_KEY,
  alertForApproval,
  claimApprovalAlert,
  isApprovalSoundMuted,
  playApprovalChime,
  resetApprovalAlerts,
  resetApprovalAudio,
  setApprovalSoundMuted,
} from "@/lib/audio/approval-alert"

function fakeContext(state: AudioContextState = "running") {
  const oscillators: Array<{ start: ReturnType<typeof vi.fn>; frequency: number }> = []
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
  const ctx = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = "running"
    }),
    createOscillator: () => {
      const osc = {
        type: "",
        frequency: {
          setValueAtTime: (hz: number) => {
            entry.frequency = hz
          },
        },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }
      const entry = { start: osc.start, frequency: 0 }
      oscillators.push(entry)
      return osc
    },
    createGain: () => ({ gain: param(), connect: vi.fn() }),
  }
  return { ctx, oscillators, create: () => ctx as unknown as AudioContext }
}

function stubStorage(): Map<string, string> {
  const data = new Map<string, string>()
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    },
  })
  return data
}

beforeEach(() => {
  resetApprovalAlerts()
  resetApprovalAudio()
})
afterEach(() => vi.unstubAllGlobals())

describe("claimApprovalAlert", () => {
  it("claims each approval id once", () => {
    expect(claimApprovalAlert("a")).toBe(true)
    expect(claimApprovalAlert("a")).toBe(false)
    expect(claimApprovalAlert("b")).toBe(true)
  })
})

describe("approval sound setting", () => {
  it("is on by default and remembers mute", () => {
    const data = stubStorage()
    expect(isApprovalSoundMuted()).toBe(false)
    setApprovalSoundMuted(true)
    expect(data.get(APPROVAL_SOUND_KEY)).toBe("off")
    expect(isApprovalSoundMuted()).toBe(true)
    setApprovalSoundMuted(false)
    expect(isApprovalSoundMuted()).toBe(false)
  })

  it("is on and does not throw without a window or storage", () => {
    expect(isApprovalSoundMuted()).toBe(false)
    expect(() => setApprovalSoundMuted(true)).not.toThrow()
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked")
      },
    })
    expect(isApprovalSoundMuted()).toBe(false)
  })
})

describe("playApprovalChime", () => {
  it("plays two rising notes", async () => {
    const { oscillators, create } = fakeContext()
    expect(await playApprovalChime(create)).toBe(true)
    expect(oscillators.map((o) => o.frequency)).toEqual([880, 1318.5])
    expect(oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true)
  })

  it("resumes a suspended context first", async () => {
    const { ctx, create } = fakeContext("suspended")
    expect(await playApprovalChime(create)).toBe(true)
    expect(ctx.resume).toHaveBeenCalled()
  })

  it("stays quiet when the browser blocks audio", async () => {
    const { ctx, create } = fakeContext("suspended")
    ctx.resume.mockImplementation(async () => {})
    expect(await playApprovalChime(create)).toBe(false)
  })

  it("stays quiet without any audio support", async () => {
    expect(await playApprovalChime()).toBe(false)
    expect(await playApprovalChime(() => {
      throw new Error("no device")
    })).toBe(false)
  })
})

describe("alertForApproval", () => {
  it("plays once per approval", async () => {
    stubStorage()
    const { oscillators, create } = fakeContext()
    expect(await alertForApproval("a", create)).toBe(true)
    expect(await alertForApproval("a", create)).toBe(false)
    expect(oscillators).toHaveLength(2)
  })

  it("stays quiet when muted, and does not replay after unmute", async () => {
    stubStorage()
    setApprovalSoundMuted(true)
    const { oscillators, create } = fakeContext()
    expect(await alertForApproval("a", create)).toBe(false)
    setApprovalSoundMuted(false)
    expect(await alertForApproval("a", create)).toBe(false)
    expect(oscillators).toHaveLength(0)
  })
})
