import { describe, expect, it } from "vitest"

import { browserMcpServerConfig } from "@/lib/browser/setup"

describe("browserMcpServerConfig", () => {
  it("opens a visible Chromium window by default", () => {
    const config = browserMcpServerConfig("/tmp/profile")
    expect(config.args).not.toContain("--headless")
    expect(config.env.PLAYWRIGHT_MCP_HEADLESS).toBe("false")
    expect(config.args).toContain("--user-data-dir")
    expect(config.args).toContain("/tmp/profile")
  })

  it("adds the headless flag when asked", () => {
    const config = browserMcpServerConfig("/tmp/profile", { headless: true })
    expect(config.args).toContain("--headless")
    expect(config.env.PLAYWRIGHT_MCP_HEADLESS).toBe("true")
  })
})
