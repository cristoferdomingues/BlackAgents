import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { testMcpServer } from "@/lib/mcp/client"
import { detectMcpCandidate, tryAndSaveMcpServer } from "@/lib/k0ding/mcp-helper"
import type { CodeRoot } from "@/lib/k0ding/schema"

vi.mock("@/lib/mcp/client", () => ({
  testMcpServer: vi.fn(),
}))

let workspace = ""
let code = ""

afterEach(async () => {
  vi.mocked(testMcpServer).mockReset()
  if (workspace) await rm(workspace, { recursive: true, force: true })
  if (code) await rm(code, { recursive: true, force: true })
})

async function setup(): Promise<CodeRoot> {
  workspace = await mkdtemp(path.join(tmpdir(), "k0-mcp-workspace-"))
  code = await mkdtemp(path.join(tmpdir(), "k0-mcp-code-"))
  await mkdir(path.join(workspace, ".black-agents"), { recursive: true })
  await writeFile(
    path.join(code, "package.json"),
    JSON.stringify({
      dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
      scripts: { start: "node dist/index.js", test: "vitest" },
    })
  )
  return { id: "server", path: code, label: "server", hidden: [] }
}

describe("K0ding MCP helper", () => {
  it("detects an MCP package and its scripts", async () => {
    const root = await setup()
    const result = await detectMcpCandidate(workspace, root)
    expect(result.detected).toBe(true)
    expect(result.scripts).toEqual(["start", "test"])
  })

  it("tests before save and sets trust to ask", async () => {
    const root = await setup()
    vi.mocked(testMcpServer).mockResolvedValue({
      name: "server",
      config: { command: "npm", args: [], env: {}, headers: {}, disabled: false },
      status: "connected",
      tools: [{ server: "server", name: "ping", inputSchema: { type: "object" } }],
      secretStatuses: { headers: { configured: false }, env: { configured: false } },
    })
    const result = await tryAndSaveMcpServer(workspace, root, { name: "server", script: "start" })
    expect(result.tools.map((tool) => tool.name)).toEqual(["ping"])
    expect(await readFile(path.join(workspace, ".black-agents/mcp.json"), "utf8")).toContain(root.path)
    expect(await readFile(path.join(workspace, ".black-agents/mcp-policy.json"), "utf8")).toContain('"server": "ask"')
  })

  it("does not save when the server fails to connect", async () => {
    const root = await setup()
    vi.mocked(testMcpServer).mockResolvedValue({
      name: "server",
      config: { command: "npm", args: [], env: {}, headers: {}, disabled: false },
      status: "error",
      tools: [],
      error: "No tools",
      secretStatuses: { headers: { configured: false }, env: { configured: false } },
    })
    await expect(tryAndSaveMcpServer(workspace, root, { name: "server", script: "start" })).rejects.toThrow("No tools")
    await expect(readFile(path.join(workspace, ".black-agents/mcp.json"), "utf8")).rejects.toThrow()
  })
})
