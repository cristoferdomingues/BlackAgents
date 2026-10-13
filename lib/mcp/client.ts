import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

import { maybeRecordBrowserTraces } from "@/lib/browser/recording"
import { getMcpSecrets } from "@/lib/secrets"

import { readWorkspaceMcpConfig } from "./config"
import { mcpServerSecretStatuses, resolveMcpServerSecrets } from "./resolve-secrets"
import { prepareStdioLaunch } from "./stdio-command"
import { mcpAuthRequestInit, resolveMcpTransport } from "./transport"
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

  const mcpSecrets = await getMcpSecrets()
  const resolved = resolveMcpServerSecrets(config, mcpSecrets)

  const kind = resolveMcpTransport(resolved)
  let transport: Transport

  if (kind === "http" || kind === "sse") {
    if (!resolved.url) {
      throw new Error(
        kind === "http" ? "HTTP server needs a URL" : "SSE server needs a URL"
      )
    }
    const url = new URL(resolved.url)
    const requestInit = mcpAuthRequestInit(resolved)
    const options = requestInit ? { requestInit } : undefined
    transport =
      kind === "http"
        ? new StreamableHTTPClientTransport(url, options)
        : new SSEClientTransport(url, options)
  } else if (resolved.command) {
    const launch = prepareStdioLaunch(resolved.command, resolved.env)
    transport = new StdioClientTransport({
      command: launch.command,
      args: resolved.args ?? [],
      env: launch.env,
      cwd,
    })
  } else {
    throw new Error("stdio server needs a command")
  }

  await withTimeout(client.connect(transport), DEFAULT_TIMEOUT_MS, "connecting to server")

  return { client, transport }
}

export async function testMcpServer(
  name: string,
  config: McpServerConfig,
  cwd?: string
): Promise<McpServerStatus> {
  const mcpSecrets = await getMcpSecrets()
  const secretStatuses = mcpServerSecretStatuses(config, mcpSecrets)

  if (config.disabled) {
    return {
      name,
      config,
      status: "disabled",
      tools: [],
      secretStatuses,
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
      secretStatuses,
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const error =
      /ENOENT/i.test(raw) && config.command
        ? `${raw}. Could not find "${config.command}" on PATH. ` +
          `Install Node.js (includes npx), or re-enable the server from Settings so the command is resolved to an absolute path.`
        : raw
    return {
      name,
      config,
      status: "error",
      tools: [],
      error,
      secretStatuses,
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
  workspaceRoot: string,
  onlyServers?: string[]
): Promise<McpServerStatus[]> {
  const mcpConfig = await readWorkspaceMcpConfig(workspaceRoot)
  const names = Object.keys(mcpConfig.mcpServers).filter(
    (name) => !onlyServers || onlyServers.includes(name)
  )
  if (names.length === 0) return []

  const statuses = await Promise.all(
    names.map((name) =>
      testMcpServer(name, mcpConfig.mcpServers[name], workspaceRoot)
    )
  )

  return statuses
}

export async function loadWorkspaceTools(
  workspaceRoot: string,
  onlyServers?: string[]
): Promise<McpTool[]> {
  const statuses = await getWorkspaceServersStatus(workspaceRoot, onlyServers)
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

    const trace = {
      id: executionId,
      server: serverName,
      tool: toolName,
      args,
      result: parsedResult,
      error: callResult.isError ? String(parsedResult) : undefined,
      durationMs: Date.now() - startTime,
    }
    maybeRecordBrowserTraces(workspaceRoot, [trace])
    return trace
  } catch (err) {
    const trace = {
      id: executionId,
      server: serverName,
      tool: toolName,
      args,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    }
    maybeRecordBrowserTraces(workspaceRoot, [trace])
    return trace
  } finally {
    if (client) {
      await client.close().catch(() => {})
    }
    if (transport) {
      await transport.close().catch(() => {})
    }
  }
}
