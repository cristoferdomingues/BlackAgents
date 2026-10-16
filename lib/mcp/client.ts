import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

import { BROWSER_MCP_SERVER } from "@/lib/browser/constants"
import { maybeRecordBrowserTraces } from "@/lib/browser/recording"
import { getMcpSecrets } from "@/lib/secrets"

import { readWorkspaceMcpConfig } from "./config"
import {
  mcpServerSecretStatuses,
  redactSecretValues,
  resolveMcpServerSecrets,
} from "./resolve-secrets"
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

/**
 * Open a live MCP session.
 * Pass `secrets` to resolve `${secret:…}` from that map instead of secrets.json.
 * Omit it to keep the normal read from secrets.json.
 */
export async function createMcpConnection(
  config: McpServerConfig,
  cwd?: string,
  secrets?: Record<string, string>
): Promise<{ client: Client; transport: Transport }> {
  const client = new Client(CLIENT_INFO, {
    capabilities: {},
  })

  const mcpSecrets = secrets ?? (await getMcpSecrets())
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

/**
 * The Playwright browser dies when its MCP process exits. Keep that process
 * alive across tool calls so a visible window stays open for login.
 */
function keepsSession(serverName: string): boolean {
  return serverName === BROWSER_MCP_SERVER
}

interface HeldSession {
  client: Client
  transport: Transport
  fingerprint: string
}

interface SessionSlot {
  held?: HeldSession
  tail: Promise<void>
}

interface SessionPool {
  slots: Map<string, SessionSlot>
}

function sessionPool(): SessionPool {
  const g = globalThis as typeof globalThis & { __blackAgentsMcpPool?: SessionPool }
  if (!g.__blackAgentsMcpPool) {
    g.__blackAgentsMcpPool = { slots: new Map() }
  }
  return g.__blackAgentsMcpPool
}

function sessionKey(workspaceRoot: string, serverName: string): string {
  return `${workspaceRoot}\0${serverName}`
}

function configFingerprint(config: McpServerConfig): string {
  return JSON.stringify({
    command: config.command ?? "",
    args: config.args ?? [],
    env: config.env ?? {},
    url: config.url ?? "",
    transport: config.transport ?? "",
    disabled: Boolean(config.disabled),
  })
}

function slotFor(key: string): SessionSlot {
  const pool = sessionPool()
  let slot = pool.slots.get(key)
  if (!slot) {
    slot = { tail: Promise.resolve() }
    pool.slots.set(key, slot)
  }
  return slot
}

function enqueue<T>(slot: SessionSlot, task: () => Promise<T>): Promise<T> {
  const run = slot.tail.then(task, task)
  slot.tail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function closeHeld(held: HeldSession): Promise<void> {
  await held.client.close().catch(() => {})
  await held.transport.close().catch(() => {})
}

/** Stop a kept MCP process (for example after the browser mode changes). */
export async function closePersistentMcpServer(
  workspaceRoot: string,
  serverName: string
): Promise<void> {
  const key = sessionKey(workspaceRoot, serverName)
  const slot = sessionPool().slots.get(key)
  if (!slot) return
  await enqueue(slot, async () => {
    if (!slot.held) return
    const held = slot.held
    slot.held = undefined
    await closeHeld(held)
  })
}

function isBrokenSessionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (/timed out/i.test(message)) return false
  return /EPIPE|ECONNRESET|not connected|connection closed|disconnect|closed/i.test(message)
}

interface AcquiredSession {
  client: Client
  transport: Transport
  persistent: boolean
  run: <T>(task: () => Promise<T>) => Promise<T>
}

async function acquireSession(
  serverName: string,
  config: McpServerConfig,
  cwd: string | undefined,
  secrets?: Record<string, string>
): Promise<AcquiredSession> {
  // An explicit map is an unsaved draft. Do not reuse or replace the kept browser process.
  if (!keepsSession(serverName) || !cwd || secrets !== undefined) {
    const opened = await createMcpConnection(config, cwd, secrets)
    return { ...opened, persistent: false, run: (task) => task() }
  }

  const key = sessionKey(cwd, serverName)
  const fingerprint = configFingerprint(config)
  const slot = slotFor(key)

  return enqueue(slot, async () => {
    let held = slot.held
    if (!held || held.fingerprint !== fingerprint) {
      if (held) {
        slot.held = undefined
        await closeHeld(held)
      }
      const opened = await createMcpConnection(config, cwd)
      held = { ...opened, fingerprint }
      slot.held = held
    }
    const current = held
    return {
      client: current.client,
      transport: current.transport,
      persistent: true,
      run: <T>(task: () => Promise<T>) => enqueue(slot, task),
    }
  })
}

async function releaseSession(session: AcquiredSession): Promise<void> {
  if (session.persistent) return
  await session.client.close().catch(() => {})
  await session.transport.close().catch(() => {})
}

/**
 * Connect and list tools.
 * Pass `secrets` to use that map (an unsaved draft) instead of secrets.json.
 * Returned `config` is the object passed in — send placeholders, not raw secrets.
 */
export async function testMcpServer(
  name: string,
  config: McpServerConfig,
  cwd?: string,
  secrets?: Record<string, string>
): Promise<McpServerStatus> {
  const mcpSecrets = secrets ?? (await getMcpSecrets())
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

  let session: AcquiredSession | null = null

  try {
    session = await acquireSession(name, config, cwd, secrets)

    const active = session
    const listResult = await active.run(() =>
      withTimeout(active.client.listTools(), DEFAULT_TIMEOUT_MS, "listing tools")
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
    const error = redactSecretValues(
      /ENOENT/i.test(raw) && config.command
        ? `${raw}. Could not find "${config.command}" on PATH. ` +
          `Install Node.js (includes npx), or re-enable the server from Settings so the command is resolved to an absolute path.`
        : raw,
      mcpSecrets,
      4
    )
    if (session?.persistent && cwd && isBrokenSessionError(err)) {
      await closePersistentMcpServer(cwd, name)
    }
    return {
      name,
      config,
      status: "error",
      tools: [],
      error,
      secretStatuses,
    }
  } finally {
    if (session) await releaseSession(session)
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

  let session: AcquiredSession | null = null

  try {
    session = await acquireSession(serverName, serverConfig, workspaceRoot)

    const active = session
    const callResult = await active.run(() =>
      withTimeout(
        active.client.callTool({
          name: toolName,
          arguments: args,
        }),
        DEFAULT_TIMEOUT_MS * 2,
        `executing tool "${toolName}" on server "${serverName}"`
      )
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
    if (session?.persistent && isBrokenSessionError(err)) {
      await closePersistentMcpServer(workspaceRoot, serverName)
    }
    maybeRecordBrowserTraces(workspaceRoot, [trace])
    return trace
  } finally {
    if (session) await releaseSession(session)
  }
}
