import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BROWSER_MCP_SERVER } from "@/lib/browser/constants"
import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

const state = vi.hoisted(() => ({
  spawns: 0,
  clientCloses: 0,
  failMessage: "",
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = vi.fn(async () => undefined)
    close = vi.fn(async () => {
      state.clientCloses += 1
    })
    callTool = vi.fn(async () => {
      if (state.failMessage) {
        const message = state.failMessage
        state.failMessage = ""
        throw new Error(message)
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] }
    })
    listTools = vi.fn(async () => ({
      tools: [
        {
          name: "browser_navigate",
          description: "go",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }))
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor() {
      state.spawns += 1
    }
    close = vi.fn(async () => undefined)
  },
}))

import { saveWorkspaceMcpServer } from "@/lib/mcp/config"
import {
  closePersistentMcpServer,
  executeWorkspaceTool,
  testMcpServer,
} from "@/lib/mcp/client"

const browserConfig = {
  command: "npx",
  args: ["-y", "@playwright/mcp@latest", "--browser", "chromium"],
  env: { PLAYWRIGHT_MCP_HEADLESS: "false" },
  headers: {},
  disabled: false,
}

describe("browser MCP session", () => {
  let env: TempEnv

  beforeEach(async () => {
    state.spawns = 0
    state.clientCloses = 0
    state.failMessage = ""
    env = await makeTempEnv()
    await saveWorkspaceMcpServer(env.workspace, BROWSER_MCP_SERVER, browserConfig)
  })

  afterEach(async () => {
    await closePersistentMcpServer(env.workspace, BROWSER_MCP_SERVER)
    await closePersistentMcpServer(env.workspace, "other")
    await env.cleanup()
  })

  it("keeps the browser process open across tool calls", async () => {
    const first = await executeWorkspaceTool(env.workspace, BROWSER_MCP_SERVER, "browser_navigate", {
      url: "https://x.com",
    })
    const second = await executeWorkspaceTool(env.workspace, BROWSER_MCP_SERVER, "browser_snapshot", {})

    expect(first.error).toBeUndefined()
    expect(second.result).toEqual({ ok: true })
    expect(state.spawns).toBe(1)
    expect(state.clientCloses).toBe(0)
  })

  it("still closes a normal MCP server after each call", async () => {
    await saveWorkspaceMcpServer(env.workspace, "other", {
      ...browserConfig,
      args: ["-y", "some-server"],
    })

    await executeWorkspaceTool(env.workspace, "other", "ping", {})
    await executeWorkspaceTool(env.workspace, "other", "ping", {})

    expect(state.spawns).toBe(2)
    expect(state.clientCloses).toBe(2)
  })

  it("restarts the browser when the launch config changes", async () => {
    await executeWorkspaceTool(env.workspace, BROWSER_MCP_SERVER, "browser_navigate", {})
    await saveWorkspaceMcpServer(env.workspace, BROWSER_MCP_SERVER, {
      ...browserConfig,
      args: [...browserConfig.args, "--headless"],
      env: { PLAYWRIGHT_MCP_HEADLESS: "true" },
    })
    await executeWorkspaceTool(env.workspace, BROWSER_MCP_SERVER, "browser_navigate", {})

    expect(state.spawns).toBe(2)
    expect(state.clientCloses).toBe(1)
  })

  it("drops a dead browser session so the next call can open a new window", async () => {
    state.failMessage = "Connection closed"
    const failed = await executeWorkspaceTool(env.workspace, BROWSER_MCP_SERVER, "browser_navigate", {})
    expect(failed.error).toMatch(/Connection closed/)
    expect(state.clientCloses).toBe(1)

    const again = await executeWorkspaceTool(env.workspace, BROWSER_MCP_SERVER, "browser_navigate", {})
    expect(again.error).toBeUndefined()
    expect(state.spawns).toBe(2)
  })

  it("does not close the browser when a tool only times out", async () => {
    state.failMessage = "Timed out after 16000ms while executing tool"
    const timedOut = await executeWorkspaceTool(env.workspace, BROWSER_MCP_SERVER, "browser_navigate", {})
    expect(timedOut.error).toMatch(/Timed out/)
    expect(state.clientCloses).toBe(0)
    expect(state.spawns).toBe(1)
  })

  it("keeps one process when listing browser tools twice", async () => {
    const first = await testMcpServer(BROWSER_MCP_SERVER, browserConfig, env.workspace)
    const second = await testMcpServer(BROWSER_MCP_SERVER, browserConfig, env.workspace)

    expect(first.status).toBe("connected")
    expect(second.tools.map((tool) => tool.name)).toEqual(["browser_navigate"])
    expect(state.spawns).toBe(1)
    expect(state.clientCloses).toBe(0)
  })
})
