import { describe, expect, it } from "vitest"

import { allowsMeetingPermission, systemAudioMode } from "../../../electron/capture.cjs"

describe("desktop meeting capture", () => {
  it("allows the microphone and screen audio, and nothing else", () => {
    expect(allowsMeetingPermission("microphone")).toBe(true)
    expect(allowsMeetingPermission("display-capture")).toBe(true)
    expect(allowsMeetingPermission("notifications")).toBe(false)
  })

  it("captures computer sound on Windows only", () => {
    expect(systemAudioMode("win32")).toBe("loopback")
    expect(systemAudioMode("darwin")).toBe("unavailable")
    expect(systemAudioMode("linux")).toBe("picker")
  })
})