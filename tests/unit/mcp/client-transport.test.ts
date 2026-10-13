import { beforeEach, describe, expect, it, vi } from "vitest"

const { httpCalls, sseCalls } = vi.hoisted(() => ({
  httpCalls: [] as Array<{ url: string; opts: unknown }>,
  sseCalls: [] as Array<{ url: string; opts: unknown }>,
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = vi.fn(async () => undefined)
    close = vi.fn(async () => undefined)
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, opts?: unknown) {
      httpCalls.push({ url: url.toString(), opts })
    }
    close = async (): Promise<void> => undefined
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    constructor(url: URL, opts?: unknown) {
      sseCalls.push({ url: url.toString(), opts })
    }
    close = async (): Promise<void> => undefined
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    close = async (): Promise<void> => undefined
  },
}))

import { createMcpConnection } from "@/lib/mcp/client"

const emptyConfig = {
  args: [] as string[],
  env: {} as Record<string, string>,
  headers: {} as Record<string, string>,
  disabled: false,
}

describe("createMcpConnection", () => {
  beforeEach(() => {
    httpCalls.length = 0
    sseCalls.length = 0
  })

  it("opens an HTTP POST client and sends the Authorization header", async () => {
    await createMcpConnection({
      ...emptyConfig,
      url: "https://app.example/api/mcp",
      transport: "http",
      headers: { Authorization: "Bearer blf_mcp_token" },
    })

    expect(httpCalls).toEqual([
      {
        url: "https://app.example/api/mcp",
        opts: { requestInit: { headers: { Authorization: "Bearer blf_mcp_token" } } },
      },
    ])
    expect(sseCalls).toEqual([])
  })

  it("uses HTTP when the saved server has a URL and no transport", async () => {
    await createMcpConnection({
      ...emptyConfig,
      url: "https://app.example/api/mcp",
      headers: { Authorization: "Bearer blf_mcp_token" },
    })

    expect(httpCalls).toHaveLength(1)
    expect(sseCalls).toEqual([])
  })

  it("uses the SSE client only when transport is sse", async () => {
    await createMcpConnection({
      ...emptyConfig,
      url: "https://mcp.example.com/sse",
      transport: "sse",
    })

    expect(sseCalls).toEqual([
      { url: "https://mcp.example.com/sse", opts: undefined },
    ])
    expect(httpCalls).toEqual([])
  })
})
