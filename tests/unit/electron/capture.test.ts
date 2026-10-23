import { describe, expect, it } from "vitest"

import { allowsAppPermission, systemAudioMode } from "../../../electron/capture.cjs"

describe("desktop meeting capture", () => {
  it("allows the microphone, screen audio, and clipboard writes, and nothing else", () => {
    expect(allowsAppPermission("microphone")).toBe(true)
    expect(allowsAppPermission("display-capture")).toBe(true)
    expect(allowsAppPermission("clipboard-sanitized-write")).toBe(true)
    expect(allowsAppPermission("clipboard-read")).toBe(false)
    expect(allowsAppPermission("notifications")).toBe(false)
  })

  it("captures computer sound on Windows only", () => {
    expect(systemAudioMode("win32")).toBe("loopback")
    expect(systemAudioMode("darwin")).toBe("unavailable")
    expect(systemAudioMode("linux")).toBe("picker")
  })
})