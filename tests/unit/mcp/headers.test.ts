import { describe, expect, it } from "vitest"

import { collectMcpHeaders } from "@/lib/mcp/headers"
import { mcpServerConfigSchema } from "@/lib/mcp/types"
import { resolveMcpTransport } from "@/lib/mcp/transport"

describe("collectMcpHeaders", () => {
  it("keeps a bearer token header and skips a blank row", () => {
    const result = collectMcpHeaders([
      { name: " Authorization ", value: "Bearer blf_mcp_token" },
      { name: "", value: "" },
    ])
    expect(result).toEqual({
      ok: true,
      headers: { Authorization: "Bearer blf_mcp_token" },
    })
  })

  it("rejects a row that has only a name", () => {
    const result = collectMcpHeaders([{ name: "Authorization", value: "  " }])
    expect(result.ok).toBe(false)
  })

  it("rejects the same header name twice", () => {
    const result = collectMcpHeaders([
      { name: "Authorization", value: "Bearer one" },
      { name: "Authorization", value: "Bearer two" },
    ])
    expect(result).toEqual({
      ok: false,
      error: 'Header "Authorization" is listed twice',
    })
  })

  it("rejects a header name with a space", () => {
    const result = collectMcpHeaders([{ name: "Bad Name", value: "x" }])
    expect(result.ok).toBe(false)
  })
})

describe("mcpServerConfigSchema remote servers", () => {
  it("accepts an HTTP server with headers", () => {
    const parsed = mcpServerConfigSchema.parse({
      url: "https://app.example/api/mcp",
      transport: "http",
      headers: { Authorization: "Bearer blf_mcp_token" },
    })
    expect(parsed.transport).toBe("http")
    expect(parsed.headers.Authorization).toBe("Bearer blf_mcp_token")
  })

  it("rejects a URL that is not http or https", () => {
    const parsed = mcpServerConfigSchema.safeParse({
      url: "ftp://files.example/mcp",
      transport: "http",
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects HTTP with no URL", () => {
    const parsed = mcpServerConfigSchema.safeParse({ transport: "http" })
    expect(parsed.success).toBe(false)
  })
})

describe("resolveMcpTransport", () => {
  it("uses HTTP when a URL has no transport", () => {
    expect(
      resolveMcpTransport({
        url: "https://app.example/api/mcp",
        args: [],
        env: {},
        headers: { Authorization: "Bearer blf_mcp_token" },
        disabled: false,
      })
    ).toBe("http")
  })

  it("uses SSE only when the user picks SSE", () => {
    expect(
      resolveMcpTransport({
        url: "https://mcp.example.com/sse",
        transport: "sse",
        args: [],
        env: {},
        headers: {},
        disabled: false,
      })
    ).toBe("sse")
  })

  it("uses stdio when a command is set", () => {
    expect(
      resolveMcpTransport({
        command: "npx",
        args: [],
        env: {},
        headers: {},
        disabled: false,
      })
    ).toBe("stdio")
  })
})
