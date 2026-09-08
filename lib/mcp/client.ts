import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

import { readWorkspaceMcpConfig } from "./config"
import type {
  McpServerConfig,
  McpServerStatus,
  McpTool,
  ToolExecutionTrace,
} from "./types"

const CLIENT_INFO = {
  name: "black-agents",
  version: "0.1.0",
}

const DEFAULT_TIMEOUT_MS = 8_000

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms while ${label}`))
    }, timeoutMs)
    promise.then(
      (res) => {
        clearTimeout(timer)
        resolve(res)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export async function createMcpConnection(
  config: McpServerConfig,
  cwd?: string
): Promise<{ client: Client; transport: Transport }> {
  const client = new Client(CLIENT_INFO, {
    capabilities: {},
  })

  let transport: Transport

  if (config.url) {
    transport = new SSEClientTransport(new URL(config.url))
  } else if (config.command) {
    const envRecord: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") envRecord[k] = v
    }
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        envRecord[k] = v
      }
    }

    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: envRecord,
      cwd,
    })
  } else {
    throw new Error("Invalid MCP server config: either 'command' or 'url' is required")
  }

  await withTimeout(client.connect(transport), DEFAULT_TIMEOUT_MS, "connecting to server")

  return { client, transport }
}

export async function testMcpServer(
  name: string,
  config: McpServerConfig,
  cwd?: string
): Promise<McpServerStatus> {
  if (config.disabled) {
    return {
      name,
      config,
      status: "disabled",
      tools: [],
    }
  }

  let client: Client | null = null
  let transport: Transport | null = null

  try {
    const connection = await createMcpConnection(config, cwd)
    client = connection.client
    transport = connection.transport

    const listResult = await withTimeout(
      client.listTools(),
      DEFAULT_TIMEOUT_MS,
      "listing tools"
    )

    const tools: McpTool[] = (listResult.tools ?? []).map((t) => ({
      server: name,
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    }))

    return {
      name,
      config,
      status: "connected",
      tools,
    }
  } catch (err) {
    return {
      name,
      config,
      status: "error",
      tools: [],
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    if (client) {
      await client.close().catch(() => {})
    }
    if (transport) {
      await transport.close().catch(() => {})
    }
  }
}

export async function getWorkspaceServersStatus(
  workspaceRoot: string
): Promise<McpServerStatus[]> {
  const mcpConfig = await readWorkspaceMcpConfig(workspaceRoot)
  const names = Object.keys(mcpConfig.mcpServers)
  if (names.length === 0) return []

  const statuses = await Promise.all(
    names.map((name) =>
      testMcpServer(name, mcpConfig.mcpServers[name], workspaceRoot)
    )
  )

  return statuses
}

export async function loadWorkspaceTools(
  workspaceRoot: string
): Promise<McpTool[]> {
  const statuses = await getWorkspaceServersStatus(workspaceRoot)
  const tools: McpTool[] = []
  for (const s of statuses) {
    if (s.status === "connected") {
      tools.push(...s.tools)
    }
  }
  return tools
}

export async function executeWorkspaceTool(
  workspaceRoot: string,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolExecutionTrace> {
  const mcpConfig = await readWorkspaceMcpConfig(workspaceRoot)
  const serverConfig = mcpConfig.mcpServers[serverName]

  const startTime = Date.now()
  const executionId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  if (!serverConfig) {
    return {
      id: executionId,
      server: serverName,
      tool: toolName,
      args,
      error: `Server "${serverName}" is not configured in this workspace`,
      durationMs: Date.now() - startTime,
    }
  }

  let client: Client | null = null
  let transport: Transport | null = null

  try {
    const connection = await createMcpConnection(serverConfig, workspaceRoot)
    client = connection.client
    transport = connection.transport

    const callResult = await withTimeout(
      client.callTool({
        name: toolName,
        arguments: args,
      }),
      DEFAULT_TIMEOUT_MS * 2,
      `executing tool "${toolName}" on server "${serverName}"`
    )

    let parsedResult: unknown = callResult
    if (Array.isArray(callResult?.content) && callResult.content.length > 0) {
      const first = callResult.content[0]
      if (first.type === "text" && typeof first.text === "string") {
        try {
          parsedResult = JSON.parse(first.text)
        } catch {
          parsedResult = first.text
        }
      }
    }

    return {
      id: executionId,
      server: serverName,
      tool: toolName,
      args,
      result: parsedResult,
      error: callResult.isError ? String(parsedResult) : undefined,
      durationMs: Date.now() - startTime,
    }
  } catch (err) {
    return {
      id: executionId,
      server: serverName,
      tool: toolName,
      args,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    }
  } finally {
    if (client) {
      await client.close().catch(() => {})
    }
    if (transport) {
      await transport.close().catch(() => {})
    }
  }
}
