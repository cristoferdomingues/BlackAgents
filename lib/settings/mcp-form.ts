import { collectMcpEnv, type McpEnvRow } from "@/lib/mcp/env"
import { collectMcpHeaders, type McpHeaderRow } from "@/lib/mcp/headers"
import { isFullSecretRef } from "@/lib/mcp/secret-refs"
import type { McpServerConfig, McpTransportType } from "@/lib/mcp/types"

export interface McpFormDraft {
  name: string
  transport: McpTransportType
  command: string
  args: string
  url: string
  headers: McpHeaderRow[]
  env: McpEnvRow[]
}

export interface McpStoredSecrets {
  headers?: Record<string, string>
  env?: Record<string, string>
}

export interface McpSaveBody {
  name: string
  config: {
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    transport: McpTransportType
    disabled?: boolean
  }
  secretHeaders?: string[]
  secretEnv?: string[]
}

export type McpSaveBuild = { ok: true; body: McpSaveBody } | { ok: false; error: string }

export interface McpConnection {
  status: "connected" | "error" | "disabled"
  toolCount: number
  error?: string
}

export function emptyMcpDraft(): McpFormDraft {
  return {
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    url: "",
    headers: [{ name: "", value: "" }],
    env: [{ name: "", value: "" }],
  }
}

export function transportOf(
  config: Pick<McpServerConfig, "transport" | "url">
): McpTransportType {
  if (config.transport === "stdio" || config.transport === "http" || config.transport === "sse") {
    return config.transport
  }
  if (config.url) return "http"
  return "stdio"
}

export function rowsFromStored(values: Record<string, string> | undefined): McpHeaderRow[] {
  const names = Object.keys(values ?? {})
  if (names.length === 0) return [{ name: "", value: "" }]
  return names.map((name) => ({ name, value: "" }))
}

export function draftFromServer(name: string, config: McpServerConfig): McpFormDraft {
  const transport = transportOf(config)
  return {
    name,
    transport,
    command: config.command ?? "",
    args: (config.args ?? []).join(" "),
    url: config.url ?? "",
    headers: transport === "stdio" ? [{ name: "", value: "" }] : rowsFromStored(config.headers),
    env: transport === "stdio" ? rowsFromStored(config.env) : [{ name: "", value: "" }],
  }
}

export function isMcpDraftDirty(current: McpFormDraft, baseline: McpFormDraft): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline)
}

/**
 * A blank secret value keeps the stored `${secret:id}` placeholder.
 * A typed value replaces it. Rows with no stored placeholder stay blank.
 */
export function keepStoredSecretValues(
  rows: McpHeaderRow[],
  stored: Record<string, string> | undefined
): McpHeaderRow[] {
  return rows.map((row) => {
    if (row.value.trim()) return row
    const name = row.name.trim()
    if (!name) return row
    const existing = stored?.[name]
    if (existing && isFullSecretRef(existing)) return { ...row, value: existing }
    return row
  })
}

export function buildMcpSaveBody(
  draft: McpFormDraft,
  stored: McpStoredSecrets | null,
  options?: { disabled?: boolean }
): McpSaveBuild {
  const name = draft.name.trim()
  if (!name) return { ok: false, error: "Please provide a server name" }
  if (draft.transport === "stdio" && !draft.command.trim()) {
    return { ok: false, error: "Command is required for stdio server" }
  }
  if (draft.transport !== "stdio" && !draft.url.trim()) {
    return { ok: false, error: "URL is required for a remote server" }
  }

  const headerRows =
    draft.transport === "stdio" ? [] : keepStoredSecretValues(draft.headers, stored?.headers)
  const envRows = draft.transport === "stdio" ? keepStoredSecretValues(draft.env, stored?.env) : []

  const collectedHeaders =
    draft.transport === "stdio"
      ? { ok: true as const, headers: {} as Record<string, string> }
      : collectMcpHeaders(headerRows)
  if (!collectedHeaders.ok) return collectedHeaders

  const collectedEnv =
    draft.transport === "stdio" ? collectMcpEnv(envRows) : { ok: true as const, env: {} as Record<string, string> }
  if (!collectedEnv.ok) return collectedEnv

  const args = draft.args
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
  const headerNames = Object.keys(collectedHeaders.headers)
  const envNames = Object.keys(collectedEnv.env)
  const disabled = options?.disabled ? ({ disabled: true } as const) : {}

  const config: McpSaveBody["config"] =
    draft.transport === "stdio"
      ? {
          command: draft.command.trim(),
          args,
          env: collectedEnv.env,
          transport: "stdio",
          ...disabled,
        }
      : {
          url: draft.url.trim(),
          headers: collectedHeaders.headers,
          transport: draft.transport,
          ...disabled,
        }

  return {
    ok: true,
    body: {
      name,
      config,
      ...(draft.transport !== "stdio" && headerNames.length > 0 ? { secretHeaders: headerNames } : {}),
      ...(draft.transport === "stdio" && envNames.length > 0 ? { secretEnv: envNames } : {}),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Read connected / error / disabled from a test or save response. */
export function readMcpConnection(data: unknown): McpConnection | null {
  if (!isRecord(data)) return null
  const source = isRecord(data.server) ? data.server : data
  const status = source.status
  if (status !== "connected" && status !== "error" && status !== "disabled") return null
  const toolCount = Array.isArray(source.tools) ? source.tools.length : 0
  const error = typeof source.error === "string" && source.error ? source.error : undefined
  return { status, toolCount, error }
}

/**
 * Some test failures should still allow save: the route is missing, or the
 * page is open without a workspace the test route can see.
 */
export function mcpTestErrorAllowsSave(message: string): boolean {
  return /no active workspace|invalid response|\b404\b|failed to fetch/i.test(message)
}
