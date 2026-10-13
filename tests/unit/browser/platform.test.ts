import { afterEach, describe, expect, it } from "vitest"

import { browserUnavailableReason, isDesktopRuntime } from "@/lib/browser/platform"
import { DESKTOP_ENV_FLAG } from "@/lib/browser/constants"

describe("browser platform gate", () => {
  afterEach(() => {
    delete process.env[DESKTOP_ENV_FLAG]
  })

  it("is off by default", () => {
    delete process.env[DESKTOP_ENV_FLAG]
    expect(isDesktopRuntime()).toBe(false)
    expect(browserUnavailableReason()).toMatch(/desktop app/i)
  })

  it("is on when BLACK_AGENTS_DESKTOP=1", () => {
    process.env[DESKTOP_ENV_FLAG] = "1"
    expect(isDesktopRuntime()).toBe(true)
    expect(browserUnavailableReason()).toBeNull()
  })
})
