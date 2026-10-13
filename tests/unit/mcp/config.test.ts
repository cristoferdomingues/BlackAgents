import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  LEGACY_CURSOR_MCP_REL_PATH,
  MCP_CONFIG_REL_PATH,
  readWorkspaceMcpConfig,
  saveWorkspaceMcpServer,
  deleteWorkspaceMcpServer,
} from "@/lib/mcp/config"

let workspaceDir: string

beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "mcp-test-ws-"))
})

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true })
})

function mcpPath(): string {
  return path.join(workspaceDir, MCP_CONFIG_REL_PATH)
}

describe("readWorkspaceMcpConfig", () => {
  it("returns an empty mcpServers object when no MCP config exists", async () => {
    const config = await readWorkspaceMcpConfig(workspaceDir)
    expect(config).toEqual({ mcpServers: {} })
  })

  it("reads and parses valid .black-agents/mcp.json", async () => {
    await mkdir(path.dirname(mcpPath()), { recursive: true })
    const sampleConfig = {
      mcpServers: {
        "sqlite-db": {
          command: "uvx",
          args: ["mcp-server-sqlite", "--db-path", "test.db"],
          env: { FOO: "bar" },
        },
      },
    }
    await writeFile(mcpPath(), JSON.stringify(sampleConfig, null, 2), "utf8")

    const result = await readWorkspaceMcpConfig(workspaceDir)
    expect(result.mcpServers["sqlite-db"]).toBeDefined()
    expect(result.mcpServers["sqlite-db"].command).toBe("uvx")
    expect(result.mcpServers["sqlite-db"].args).toEqual([
      "mcp-server-sqlite",
      "--db-path",
      "test.db",
    ])
  })

  it("migrates a legacy .cursor/mcp.json into .black-agents/mcp.json", async () => {
    const legacyAbs = path.join(workspaceDir, LEGACY_CURSOR_MCP_REL_PATH)
    await mkdir(path.dirname(legacyAbs), { recursive: true })
    await writeFile(
      legacyAbs,
      JSON.stringify({
        mcpServers: {
          github: {
            url: "https://api.githubcopilot.com/mcp/",
            headers: {
              Authorization: "${secret:mcp.github.header.Authorization}",
            },
          },
        },
      }),
      "utf8"
    )

    const result = await readWorkspaceMcpConfig(workspaceDir)
    expect(result.mcpServers.github?.url).toBe(
      "https://api.githubcopilot.com/mcp/"
    )

    const migrated = JSON.parse(await readFile(mcpPath(), "utf8")) as {
      mcpServers: Record<string, { url?: string }>
    }
    expect(migrated.mcpServers.github?.url).toBe(
      "https://api.githubcopilot.com/mcp/"
    )
  })

  it("prefers .black-agents/mcp.json over a legacy Cursor file", async () => {
    await mkdir(path.dirname(mcpPath()), { recursive: true })
    await writeFile(
      mcpPath(),
      JSON.stringify({
        mcpServers: {
          owned: { command: "echo", args: ["owned"] },
        },
      }),
      "utf8"
    )
    const legacyAbs = path.join(workspaceDir, LEGACY_CURSOR_MCP_REL_PATH)
    await mkdir(path.dirname(legacyAbs), { recursive: true })
    await writeFile(
      legacyAbs,
      JSON.stringify({
        mcpServers: {
          legacy: { command: "echo", args: ["legacy"] },
        },
      }),
      "utf8"
    )

    const result = await readWorkspaceMcpConfig(workspaceDir)
    expect(Object.keys(result.mcpServers)).toEqual(["owned"])
  })

  it("recovers gracefully from corrupted JSON file", async () => {
    await mkdir(path.dirname(mcpPath()), { recursive: true })
    await writeFile(mcpPath(), "NOT_JSON", "utf8")

    const result = await readWorkspaceMcpConfig(workspaceDir)
    expect(result).toEqual({ mcpServers: {} })
  })

  it("reads a URL server that has headers and no transport", async () => {
    await mkdir(path.dirname(mcpPath()), { recursive: true })
    await writeFile(
      mcpPath(),
      JSON.stringify({
        mcpServers: {
          blacklionfi: {
            url: "https://app.example/api/mcp",
            headers: { Authorization: "Bearer blf_mcp_token" },
          },
        },
      }),
      "utf8"
    )

    const result = await readWorkspaceMcpConfig(workspaceDir)
    expect(result.mcpServers["blacklionfi"].url).toBe("https://app.example/api/mcp")
    expect(result.mcpServers["blacklionfi"].headers).toEqual({
      Authorization: "Bearer blf_mcp_token",
    })
    expect(result.mcpServers["blacklionfi"].transport).toBeUndefined()
  })
})

describe("saveWorkspaceMcpServer", () => {
  it("saves a new server configuration into .black-agents/mcp.json", async () => {
    const serverConfig = {
      command: "node",
      args: ["server.js"],
      env: { PORT: "8080" },
    }

    const updated = await saveWorkspaceMcpServer(
      workspaceDir,
      "custom-node",
      serverConfig
    )

    expect(updated.mcpServers["custom-node"]).toEqual({
      command: "node",
      args: ["server.js"],
      env: { PORT: "8080" },
      headers: {},
      disabled: false,
    })

    const content = await readFile(mcpPath(), "utf8")
    const diskParsed = JSON.parse(content)
    expect(diskParsed.mcpServers["custom-node"].command).toBe("node")
  })

  it("saves an HTTP server with headers and keeps transport http", async () => {
    const updated = await saveWorkspaceMcpServer(workspaceDir, "blacklionfi", {
      url: "https://app.example/api/mcp",
      headers: { Authorization: "Bearer blf_mcp_token" },
      transport: "http",
    })

    expect(updated.mcpServers["blacklionfi"]).toMatchObject({
      url: "https://app.example/api/mcp",
      headers: { Authorization: "Bearer blf_mcp_token" },
      transport: "http",
    })
    const content = await readFile(mcpPath(), "utf8")
    const diskParsed = JSON.parse(content) as {
      mcpServers: Record<
        string,
        { url?: string; headers?: Record<string, string>; transport?: string }
      >
    }
    expect(diskParsed.mcpServers["blacklionfi"].url).toBe("https://app.example/api/mcp")
    expect(diskParsed.mcpServers["blacklionfi"].headers).toEqual({
      Authorization: "Bearer blf_mcp_token",
    })
    expect(diskParsed.mcpServers["blacklionfi"].transport).toBe("http")
  })

  it("keeps transport sse on disk for an SSE server", async () => {
    await saveWorkspaceMcpServer(workspaceDir, "legacy", {
      url: "https://mcp.example.com/sse",
      transport: "sse",
    })

    const content = await readFile(mcpPath(), "utf8")
    const diskParsed = JSON.parse(content) as {
      mcpServers: Record<string, { transport?: string }>
    }
    expect(diskParsed.mcpServers["legacy"].transport).toBe("sse")
  })

  it("updates an existing server configuration without removing others", async () => {
    await saveWorkspaceMcpServer(workspaceDir, "server-one", {
      command: "echo",
      args: ["1"],
    })
    await saveWorkspaceMcpServer(workspaceDir, "server-two", {
      command: "echo",
      args: ["2"],
    })

    const updated = await saveWorkspaceMcpServer(workspaceDir, "server-one", {
      command: "echo",
      args: ["1-updated"],
    })

    expect(Object.keys(updated.mcpServers)).toContain("server-one")
    expect(Object.keys(updated.mcpServers)).toContain("server-two")
    expect(updated.mcpServers["server-one"].args).toEqual(["1-updated"])
  })
})

describe("deleteWorkspaceMcpServer", () => {
  it("removes a configured server from .black-agents/mcp.json", async () => {
    await saveWorkspaceMcpServer(workspaceDir, "to-remove", {
      command: "npx",
      args: ["remove-me"],
    })
    await saveWorkspaceMcpServer(workspaceDir, "to-keep", {
      command: "npx",
      args: ["keep-me"],
    })

    const updated = await deleteWorkspaceMcpServer(workspaceDir, "to-remove")
    expect(updated.mcpServers["to-remove"]).toBeUndefined()
    expect(updated.mcpServers["to-keep"]).toBeDefined()

    const content = await readFile(mcpPath(), "utf8")
    const diskParsed = JSON.parse(content)
    expect(diskParsed.mcpServers["to-remove"]).toBeUndefined()
    expect(diskParsed.mcpServers["to-keep"]).toBeDefined()
  })

  it("handles deleting a non-existent server without error", async () => {
    const updated = await deleteWorkspaceMcpServer(workspaceDir, "non-existent")
    expect(updated).toEqual({ mcpServers: {} })
  })
})
