import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import { readFile } from "node:fs/promises"

import { GET, POST, DELETE } from "@/app/api/mcp/route"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  await env.cleanup()
})

describe("GET /api/mcp", () => {
  it("returns empty servers and 0 totalTools when workspace has no MCP servers", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.servers).toEqual([])
    expect(json.data.totalTools).toBe(0)
  })
})

describe("POST /api/mcp", () => {
  it("rejects request without a name", async () => {
    const res = await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        config: { command: "node" },
      })
    )
    expect(res.status).toBe(400)
  })

  it("rejects server config without command or url", async () => {
    const res = await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "test-server",
        config: {},
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("Either 'command' or 'url' must be specified")
  })

  it("saves a valid stdio server configuration to workspace", async () => {
    const res = await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "my-service",
        config: {
          command: "node",
          args: ["-e", "console.log('hi')"],
          disabled: true,
        },
      })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.server.name).toBe("my-service")
    expect(json.data.server.status).toBe("disabled")

    // Verify .cursor/mcp.json exists in workspace
    const mcpContent = await readFile(
      path.join(env.workspace, ".cursor", "mcp.json"),
      "utf8"
    )
    const parsed = JSON.parse(mcpContent)
    expect(parsed.mcpServers["my-service"]).toBeDefined()
    expect(parsed.mcpServers["my-service"].command).toBe("node")
  })
})

describe("DELETE /api/mcp", () => {
  it("rejects delete request without name parameter", async () => {
    const req = new Request("http://t/api/mcp", { method: "DELETE" })
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })

  it("deletes configured server from .cursor/mcp.json", async () => {
    // First create a server
    await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "to-delete",
        config: {
          command: "node",
          disabled: true,
        },
      })
    )

    // Now delete it
    const req = new Request("http://t/api/mcp?name=to-delete", {
      method: "DELETE",
    })
    const res = await DELETE(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.success).toBe(true)
    expect(json.data.deleted).toBe("to-delete")

    // Check disk
    const mcpContent = await readFile(
      path.join(env.workspace, ".cursor", "mcp.json"),
      "utf8"
    )
    const parsed = JSON.parse(mcpContent)
    expect(parsed.mcpServers["to-delete"]).toBeUndefined()
  })
})
