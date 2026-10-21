import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const { httpCalls, sseCalls, stdioCalls, connectState } = vi.hoisted(() => ({
  httpCalls: [] as Array<{ url: string; opts: { requestInit?: RequestInit } | undefined }>,
  sseCalls: [] as Array<{ url: string; opts: { requestInit?: RequestInit } | undefined }>,
  stdioCalls: [] as Array<{ command: string; args: string[]; env?: Record<string, string> }>,
  connectState: {
    connect: async (): Promise<void> => undefined,
    clientCloses: 0,
    transportCloses: 0,
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = vi.fn(() => connectState.connect())
    close = vi.fn(async () => {
      connectState.clientCloses += 1
    })
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, opts?: { requestInit?: RequestInit }) {
      httpCalls.push({ url: url.toString(), opts })
    }
    close = async (): Promise<void> => {
      connectState.transportCloses += 1
    }
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    constructor(url: URL, opts?: { requestInit?: RequestInit }) {
      sseCalls.push({ url: url.toString(), opts })
    }
    close = async (): Promise<void> => {
      connectState.transportCloses += 1
    }
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(opts: { command: string; args?: string[]; env?: Record<string, string> }) {
      stdioCalls.push({
        command: opts.command,
        args: opts.args ?? [],
        env: opts.env,
      })
    }
    close = async (): Promise<void> => undefined
  },
}))

import { createMcpConnection } from "@/lib/mcp/client"
import { setMcpSecrets } from "@/lib/secrets"

const emptyConfig = {
  args: [] as string[],
  env: {} as Record<string, string>,
  headers: {} as Record<string, string>,
  disabled: false,
}

describe("createMcpConnection", () => {
  let configDir: string

  beforeEach(async () => {
    httpCalls.length = 0
    sseCalls.length = 0
    stdioCalls.length = 0
    connectState.connect = async () => undefined
    connectState.clientCloses = 0
    connectState.transportCloses = 0
    configDir = await mkdtemp(path.join(tmpdir(), "ba-mcp-conn-"))
    process.env.BLACK_AGENTS_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    delete process.env.BLACK_AGENTS_CONFIG_DIR
    await rm(configDir, { recursive: true, force: true })
  })

  it("opens an HTTP POST client and sends the Authorization header", async () => {
    await createMcpConnection({
      ...emptyConfig,
      url: "https://app.example/api/mcp",
      transport: "http",
      headers: { Authorization: "Bearer blf_mcp_token" },
    })

    expect(httpCalls[0]?.url).toBe("https://app.example/api/mcp")
    expect(httpCalls[0]?.opts?.requestInit?.headers).toEqual({ Authorization: "Bearer blf_mcp_token" })
    expect(httpCalls[0]?.opts?.requestInit?.signal).toBeInstanceOf(AbortSignal)
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

    expect(sseCalls[0]?.url).toBe("https://mcp.example.com/sse")
    expect(sseCalls[0]?.opts?.requestInit?.signal).toBeInstanceOf(AbortSignal)
    expect(httpCalls).toEqual([])
  })

  it("resolves bare stdio commands against an enriched PATH", async () => {
    await createMcpConnection({
      ...emptyConfig,
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
    })

    expect(stdioCalls).toHaveLength(1)
    expect(stdioCalls[0]?.env?.PATH).toBeTruthy()
    // Prefer absolute path when npx exists on this machine.
    const cmd = stdioCalls[0]?.command ?? ""
    expect(cmd === "npx" || path.isAbsolute(cmd)).toBe(true)
  })

  it("resolves ${secret:…} env values before starting a stdio server", async () => {
    await setMcpSecrets({
      "mcp.github.env.GITHUB_TOKEN": "ghp_from_secrets",
    })

    await createMcpConnection({
      ...emptyConfig,
      command: "node",
      args: ["server.js"],
      env: {
        GITHUB_TOKEN: "${secret:mcp.github.env.GITHUB_TOKEN}",
      },
    })

    expect(stdioCalls).toHaveLength(1)
    expect(stdioCalls[0]?.env?.GITHUB_TOKEN).toBe("ghp_from_secrets")
    expect(JSON.stringify(stdioCalls[0]?.env)).not.toContain("${secret:")
  })

  it("resolves ${secret:…} headers before opening the HTTP client", async () => {
    await setMcpSecrets({
      "mcp.github.header.Authorization": "Bearer ghp_from_secrets",
    })

    await createMcpConnection({
      ...emptyConfig,
      url: "https://api.githubcopilot.com/mcp/",
      transport: "http",
      headers: {
        Authorization: "${secret:mcp.github.header.Authorization}",
      },
    })

    expect(httpCalls[0]?.url).toBe("https://api.githubcopilot.com/mcp/")
    expect(httpCalls[0]?.opts?.requestInit?.headers).toEqual({ Authorization: "Bearer ghp_from_secrets" })
  })

  it("closes a connection that never finishes", async () => {
    connectState.connect = () => new Promise(() => undefined)
    await expect(
      createMcpConnection(
        {
          ...emptyConfig,
          url: "https://mcp.example.com/sse",
          transport: "sse",
        },
        undefined,
        undefined,
        { connectTimeoutMs: 20 }
      )
    ).rejects.toThrow(/connection was closed/)
    expect(connectState.clientCloses).toBe(1)
    expect(connectState.transportCloses).toBe(1)
    expect(sseCalls[0]?.opts?.requestInit?.signal?.aborted).toBe(true)
  })
})
