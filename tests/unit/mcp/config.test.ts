import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
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

describe("readWorkspaceMcpConfig", () => {
  it("returns an empty mcpServers object when .cursor/mcp.json does not exist", async () => {
    const config = await readWorkspaceMcpConfig(workspaceDir)
    expect(config).toEqual({ mcpServers: {} })
  })

  it("reads and parses valid .cursor/mcp.json", async () => {
    const cursorDir = path.join(workspaceDir, ".cursor")
    await mkdir(cursorDir, { recursive: true })
    const sampleConfig = {
      mcpServers: {
        "sqlite-db": {
          command: "uvx",
          args: ["mcp-server-sqlite", "--db-path", "test.db"],
          env: { FOO: "bar" },
        },
      },
    }
    await writeFile(
      path.join(cursorDir, "mcp.json"),
      JSON.stringify(sampleConfig, null, 2),
      "utf8"
    )

    const result = await readWorkspaceMcpConfig(workspaceDir)
    expect(result.mcpServers["sqlite-db"]).toBeDefined()
    expect(result.mcpServers["sqlite-db"].command).toBe("uvx")
    expect(result.mcpServers["sqlite-db"].args).toEqual([
      "mcp-server-sqlite",
      "--db-path",
      "test.db",
    ])
  })

  it("recovers gracefully from corrupted JSON file", async () => {
    const cursorDir = path.join(workspaceDir, ".cursor")
    await mkdir(cursorDir, { recursive: true })
    await writeFile(path.join(cursorDir, "mcp.json"), "NOT_JSON", "utf8")

    const result = await readWorkspaceMcpConfig(workspaceDir)
    expect(result).toEqual({ mcpServers: {} })
  })
})

describe("saveWorkspaceMcpServer", () => {
  it("saves a new server configuration into .cursor/mcp.json", async () => {
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
      disabled: false,
    })

    // Verify it was persisted to disk
    const content = await readFile(
      path.join(workspaceDir, ".cursor", "mcp.json"),
      "utf8"
    )
    const diskParsed = JSON.parse(content)
    expect(diskParsed.mcpServers["custom-node"].command).toBe("node")
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

    // Update server-one
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
  it("removes a configured server from .cursor/mcp.json", async () => {
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

    // Verify persistence
    const content = await readFile(
      path.join(workspaceDir, ".cursor", "mcp.json"),
      "utf8"
    )
    const diskParsed = JSON.parse(content)
    expect(diskParsed.mcpServers["to-remove"]).toBeUndefined()
    expect(diskParsed.mcpServers["to-keep"]).toBeDefined()
  })

  it("handles deleting a non-existent server without error", async () => {
    const updated = await deleteWorkspaceMcpServer(workspaceDir, "non-existent")
    expect(updated).toEqual({ mcpServers: {} })
  })
})
