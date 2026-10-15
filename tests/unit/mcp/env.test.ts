import { describe, expect, it } from "vitest"

import { collectMcpEnv } from "@/lib/mcp/env"

describe("collectMcpEnv", () => {
  it("keeps a token variable and skips a blank row", () => {
    const result = collectMcpEnv([
      { name: " GITHUB_TOKEN ", value: "ghp_test_token" },
      { name: "", value: "" },
    ])
    expect(result).toEqual({
      ok: true,
      env: { GITHUB_TOKEN: "ghp_test_token" },
    })
  })

  it("rejects a row that has only a name", () => {
    const result = collectMcpEnv([{ name: "API_KEY", value: "  " }])
    expect(result.ok).toBe(false)
  })

  it("rejects the same variable name twice", () => {
    const result = collectMcpEnv([
      { name: "API_KEY", value: "one" },
      { name: "API_KEY", value: "two" },
    ])
    expect(result).toEqual({
      ok: false,
      error: 'Variable "API_KEY" is listed twice',
    })
  })

  it("rejects a variable name with a space or a hyphen", () => {
    expect(collectMcpEnv([{ name: "Bad Name", value: "x" }]).ok).toBe(false)
    expect(collectMcpEnv([{ name: "BAD-NAME", value: "x" }]).ok).toBe(false)
  })

  it("rejects a value with a line break", () => {
    const result = collectMcpEnv([{ name: "API_KEY", value: "abc\ndef" }])
    expect(result.ok).toBe(false)
  })
})
