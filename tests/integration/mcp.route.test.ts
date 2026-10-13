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

    const mcpContent = await readFile(
      path.join(env.workspace, ".black-agents", "mcp.json"),
      "utf8"
    )
    const parsed = JSON.parse(mcpContent)
    expect(parsed.mcpServers["my-service"]).toBeDefined()
    expect(parsed.mcpServers["my-service"].command).toBe("node")
  })

  it("saves an HTTP server with an Authorization header", async () => {
    const res = await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "blacklionfi",
        config: {
          url: "https://app.example/api/mcp",
          headers: { Authorization: "Bearer blf_mcp_token" },
          transport: "http",
          disabled: true,
        },
      })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.server.status).toBe("disabled")
    expect(json.data.server.config.transport).toBe("http")
    expect(json.data.server.config.headers).toEqual({
      Authorization: "Bearer blf_mcp_token",
    })

    const mcpContent = await readFile(
      path.join(env.workspace, ".black-agents", "mcp.json"),
      "utf8"
    )
    const parsed = JSON.parse(mcpContent) as {
      mcpServers: Record<string, { transport?: string; headers?: Record<string, string> }>
    }
    expect(parsed.mcpServers["blacklionfi"].transport).toBe("http")
    expect(parsed.mcpServers["blacklionfi"].headers?.Authorization).toBe(
      "Bearer blf_mcp_token"
    )
  })

  it("stores Authorization as a secret and writes a placeholder to mcp.json", async () => {
    const res = await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "github",
        config: {
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer ghp_test_token_9999" },
          transport: "http",
          disabled: true,
        },
        secretHeaders: ["Authorization"],
      })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.server.config.headers.Authorization).toBe(
      "${secret:mcp.github.header.Authorization}"
    )
    expect(json.data.server.secretStatuses).toEqual({
      "mcp.github.header.Authorization": { configured: true, last4: "9999" },
    })

    const mcpContent = await readFile(
      path.join(env.workspace, ".black-agents", "mcp.json"),
      "utf8"
    )
    expect(mcpContent).toContain("${secret:mcp.github.header.Authorization}")
    expect(mcpContent).not.toContain("ghp_test_token_9999")

    const secretsRaw = await readFile(
      path.join(env.configDir, "secrets.json"),
      "utf8"
    )
    const secrets = JSON.parse(secretsRaw) as {
      mcp?: Record<string, string>
    }
    expect(secrets.mcp?.["mcp.github.header.Authorization"]).toBe(
      "Bearer ghp_test_token_9999"
    )
  })

  it("rejects an HTTP server with no URL", async () => {
    const res = await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "blacklionfi",
        config: { transport: "http" },
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain("URL is required")
  })

  it("rejects a header value with a line break", async () => {
    const res = await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "blacklionfi",
        config: {
          url: "https://app.example/api/mcp",
          transport: "http",
          headers: { Authorization: "Bearer bad\ntoken" },
        },
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
  })
})

describe("DELETE /api/mcp", () => {
  it("rejects delete request without name parameter", async () => {
    const req = new Request("http://t/api/mcp", { method: "DELETE" })
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })

  it("deletes configured server from .black-agents/mcp.json", async () => {
    await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "to-delete",
        config: {
          command: "node",
          disabled: true,
        },
      })
    )

    const req = new Request("http://t/api/mcp?name=to-delete", {
      method: "DELETE",
    })
    const res = await DELETE(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.success).toBe(true)
    expect(json.data.deleted).toBe("to-delete")

    const mcpContent = await readFile(
      path.join(env.workspace, ".black-agents", "mcp.json"),
      "utf8"
    )
    const parsed = JSON.parse(mcpContent)
    expect(parsed.mcpServers["to-delete"]).toBeUndefined()
  })

  it("removes MCP secrets when the server is deleted", async () => {
    await POST(
      jsonRequest("http://t/api/mcp", "POST", {
        name: "github",
        config: {
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "Bearer ghp_to_remove" },
          transport: "http",
          disabled: true,
        },
        secretHeaders: ["Authorization"],
      })
    )

    const res = await DELETE(
      new Request("http://t/api/mcp?name=github", { method: "DELETE" })
    )
    expect(res.status).toBe(200)

    const secretsRaw = await readFile(
      path.join(env.configDir, "secrets.json"),
      "utf8"
    )
    const secrets = JSON.parse(secretsRaw) as {
      mcp?: Record<string, string>
    }
    expect(secrets.mcp?.["mcp.github.header.Authorization"]).toBeUndefined()
  })
})
