import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/mcp/test/route"
import type { McpServerConfig, McpServerStatus } from "@/lib/mcp/types"
import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

type TestMcpServer = (
  name: string,
  config: McpServerConfig,
  cwd?: string,
  secrets?: Record<string, string>
) => Promise<McpServerStatus>

const testMcpServer = vi.hoisted(() => vi.fn<TestMcpServer>())

vi.mock("@/lib/mcp/client", () => ({
  testMcpServer,
}))

const RAW_HEADER = "Bearer ghp_test_token_9999"
const STORED_ENV = "ghp_stdio_stored_4242"
const HEADER_ID = "mcp.github.header.Authorization"
const ENV_ID = "mcp.github.env.GITHUB_TOKEN"

let env: TempEnv

function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT"
}

async function readMaybe(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8")
  } catch (err: unknown) {
    if (isEnoent(err)) return null
    throw err
  }
}

function secretsPath(): string {
  return path.join(env.configDir, "secrets.json")
}

function mcpPath(): string {
  return path.join(env.workspace, ".black-agents", "mcp.json")
}

async function snapshot(): Promise<{ secrets: string | null; mcp: string | null }> {
  return {
    secrets: await readMaybe(secretsPath()),
    mcp: await readMaybe(mcpPath()),
  }
}

async function seedSecrets(mcp: Record<string, string>): Promise<void> {
  await writeFile(
    secretsPath(),
    JSON.stringify({ providers: {}, mcp }, null, 2),
    "utf8"
  )
}

async function seedMcpFile(): Promise<void> {
  await mkdir(path.dirname(mcpPath()), { recursive: true })
  await writeFile(
    mcpPath(),
    JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "server"] } } }, null, 2),
    "utf8"
  )
}

function connected(name: string, config: McpServerConfig): McpServerStatus {
  return { name, config, status: "connected", tools: [] }
}

beforeEach(async () => {
  env = await makeTempEnv()
  testMcpServer.mockReset()
  testMcpServer.mockImplementation(async (name, config) => connected(name, config))
})

afterEach(async () => {
  await env.cleanup()
})

describe("POST /api/mcp/test", () => {
  it("does not write mcp.json or secrets.json", async () => {
    await seedSecrets({ [ENV_ID]: STORED_ENV })
    await seedMcpFile()
    const before = await snapshot()

    const res = await POST(
      jsonRequest("http://t/api/mcp/test", "POST", {
        name: "github",
        config: {
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: RAW_HEADER },
          transport: "http",
        },
        secretHeaders: ["Authorization"],
      })
    )

    expect(res.status).toBe(200)
    const after = await snapshot()
    expect(after).toEqual(before)
    expect(after.secrets).not.toContain(RAW_HEADER)
    expect(after.mcp).not.toContain(RAW_HEADER)
    await access(secretsPath())
    await access(mcpPath())
  })

  it("connects with a raw draft secret and returns only the placeholder", async () => {
    const before = await snapshot()
    const res = await POST(
      jsonRequest("http://t/api/mcp/test", "POST", {
        name: "github",
        config: {
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: RAW_HEADER },
          transport: "http",
        },
        secretHeaders: ["Authorization"],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      success: boolean
      data: McpServerStatus
    }
    expect(json.success).toBe(true)
    expect(json.data.status).toBe("connected")
    expect(json.data.config.headers.Authorization).toBe(`\${secret:${HEADER_ID}}`)
    expect(JSON.stringify(json)).not.toContain(RAW_HEADER)
    expect(await snapshot()).toEqual(before)

    expect(testMcpServer).toHaveBeenCalledTimes(1)
    const secrets = testMcpServer.mock.calls[0]?.[3]
    const config = testMcpServer.mock.calls[0]?.[1]
    expect(secrets?.[HEADER_ID]).toBe(RAW_HEADER)
    expect(config?.headers.Authorization).toBe(`\${secret:${HEADER_ID}}`)
  })

  it("reuses a stored secret when the edit sends a ${secret:id} placeholder", async () => {
    await seedSecrets({ [HEADER_ID]: RAW_HEADER, [ENV_ID]: STORED_ENV })
    await seedMcpFile()
    const before = await snapshot()

    const res = await POST(
      jsonRequest("http://t/api/mcp/test", "POST", {
        name: "github",
        config: {
          command: "npx",
          args: ["-y", "server"],
          env: { GITHUB_TOKEN: `\${secret:${ENV_ID}}` },
          transport: "stdio",
        },
        secretEnv: ["GITHUB_TOKEN"],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; data: McpServerStatus }
    expect(json.success).toBe(true)
    expect(json.data.config.env.GITHUB_TOKEN).toBe(`\${secret:${ENV_ID}}`)
    expect(JSON.stringify(json)).not.toContain(STORED_ENV)
    expect(JSON.stringify(json)).not.toContain(RAW_HEADER)

    const secrets = testMcpServer.mock.calls[0]?.[3]
    expect(secrets?.[ENV_ID]).toBe(STORED_ENV)
    expect(secrets?.[HEADER_ID]).toBe(RAW_HEADER)
    expect(await snapshot()).toEqual(before)
  })

  it("returns 412 when a ${secret:id} placeholder has no stored secret", async () => {
    const before = await snapshot()
    const res = await POST(
      jsonRequest("http://t/api/mcp/test", "POST", {
        name: "github",
        config: {
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: `\${secret:${HEADER_ID}}` },
          transport: "http",
        },
        secretHeaders: ["Authorization"],
      })
    )

    expect(res.status).toBe(412)
    const json = (await res.json()) as { success: boolean; error: string }
    expect(json.success).toBe(false)
    expect(json.error).toContain(`MCP secret "${HEADER_ID}" is not configured`)
    expect(testMcpServer).not.toHaveBeenCalled()
    expect(await snapshot()).toEqual(before)
  })

  it("redacts draft and stored secrets from the test result", async () => {
    await seedSecrets({ [ENV_ID]: STORED_ENV })
    testMcpServer.mockImplementation(async (name, config, _cwd, secrets) => ({
      name,
      status: "connected",
      config: {
        ...config,
        headers: { Authorization: secrets?.[HEADER_ID] ?? "" },
      },
      error: undefined,
      tools: [
        {
          server: name,
          name: "list",
          description: `header ${secrets?.[HEADER_ID] ?? ""} env ${secrets?.[ENV_ID] ?? ""}`,
          inputSchema: { note: secrets?.[ENV_ID] ?? "" },
        },
      ],
    }))

    const res = await POST(
      jsonRequest("http://t/api/mcp/test", "POST", {
        name: "github",
        config: {
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: RAW_HEADER },
          transport: "http",
        },
        secretHeaders: ["Authorization"],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; data: McpServerStatus }
    expect(json.success).toBe(true)
    expect(json.data.config.headers.Authorization).toBe(`\${secret:${HEADER_ID}}`)
    expect(json.data.tools[0]?.description).toBe("header ••••9999 env ••••4242")
    expect(json.data.tools[0]?.inputSchema.note).toBe("••••4242")
    const body = JSON.stringify(json)
    expect(body).not.toContain("ghp_test_token_9999")
    expect(body).not.toContain("ghp_stdio_stored_4242")
  })

  it("returns the connection error status without writing secrets", async () => {
    await seedMcpFile()
    const before = await snapshot()
    testMcpServer.mockImplementation(async (name, config) => ({
      name,
      config,
      status: "error",
      tools: [],
      error: "connection refused",
    }))

    const res = await POST(
      jsonRequest("http://t/api/mcp/test", "POST", {
        name: "github",
        config: {
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: RAW_HEADER },
          transport: "http",
        },
        secretHeaders: ["Authorization"],
      })
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; data: McpServerStatus }
    expect(json.success).toBe(true)
    expect(json.data.status).toBe("error")
    expect(json.data.error).toBe("connection refused")
    expect(json.data.config.headers.Authorization).toBe(`\${secret:${HEADER_ID}}`)
    expect(JSON.stringify(json)).not.toContain(RAW_HEADER)
    expect(await snapshot()).toEqual(before)
  })
})
