import {
  findSecretRefs,
  formatSecretRef,
  resolveSecretRefs,
} from "@/lib/mcp/secret-refs"
import type { McpSecretStatus, McpServerConfig, McpServerStatus } from "@/lib/mcp/types"

function resolveRecord(
  values: Record<string, string>,
  secrets: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    next[key] = resolveSecretRefs(value, secrets)
  }
  return next
}

/** Expand `${secret:…}` placeholders in headers and env for a live connection. */
export function resolveMcpServerSecrets(
  config: McpServerConfig,
  secrets: Record<string, string>
): McpServerConfig {
  return {
    ...config,
    headers: resolveRecord(config.headers ?? {}, secrets),
    env: resolveRecord(config.env ?? {}, secrets),
  }
}

/** Every secret id referenced by a server config. */
export function collectMcpServerSecretIds(config: McpServerConfig): string[] {
  const ids: string[] = []
  for (const value of Object.values(config.headers ?? {})) {
    for (const id of findSecretRefs(value)) {
      if (!ids.includes(id)) ids.push(id)
    }
  }
  for (const value of Object.values(config.env ?? {})) {
    for (const id of findSecretRefs(value)) {
      if (!ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

/**
 * Replace raw secret values in a client-facing string.
 * Longer values are replaced first so a short secret cannot cut a longer one.
 */
export function redactSecretValues(
  message: string,
  secrets: Record<string, string>,
  minLength = 8
): string {
  const values = [...new Set(Object.values(secrets))]
    .filter((value) => value.length >= minLength)
    .sort((a, b) => b.length - a.length)

  let redacted = message
  for (const value of values) {
    if (!redacted.includes(value)) continue
    redacted = redacted.split(value).join(`••••${value.slice(-4)}`)
  }
  return redacted
}

/** First `${secret:id}` on this server that has no stored value. */
export function firstMissingMcpSecret(
  config: McpServerConfig,
  secrets: Record<string, string>
): string | null {
  for (const id of collectMcpServerSecretIds(config)) {
    if (!secrets[id]?.trim()) return id
  }
  return null
}

/** If a header or env value is exactly a secret, put the placeholder back. */
function maskExactSecrets(
  values: Record<string, string>,
  secrets: Record<string, string>
): Record<string, string> {
  const idByValue = new Map<string, string>()
  for (const [id, value] of Object.entries(secrets)) {
    if (value && !idByValue.has(value)) idByValue.set(value, id)
  }

  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    const id = idByValue.get(value)
    next[key] = id ? formatSecretRef(id) : value
  }
  return next
}

function redactUnknown(value: unknown, secrets: Record<string, string>): unknown {
  if (typeof value === "string") return redactSecretValues(value, secrets)
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, secrets))
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      next[key] = redactUnknown(item, secrets)
    }
    return next
  }
  return value
}

function redactInputSchema(
  schema: Record<string, unknown>,
  secrets: Record<string, string>
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    next[key] = redactUnknown(value, secrets)
  }
  return next
}

/**
 * Copy a status with raw secret values removed from text the client can see.
 * `secrets` is every value that was used to connect (stored + draft).
 * `draftSecrets` is only the unsaved values; those are masked in headers and env.
 * Stored secrets are not copied over plain header text.
 */
export function redactMcpServerStatus(
  status: McpServerStatus,
  secrets: Record<string, string>,
  draftSecrets: Record<string, string> = {}
): McpServerStatus {
  return {
    name: status.name,
    status: status.status,
    error: status.error ? redactSecretValues(status.error, secrets, 4) : undefined,
    secretStatuses: status.secretStatuses,
    config: {
      ...status.config,
      headers: maskExactSecrets(status.config.headers ?? {}, draftSecrets),
      env: maskExactSecrets(status.config.env ?? {}, draftSecrets),
    },
    tools: status.tools.map((tool) => ({
      server: tool.server,
      name: redactSecretValues(tool.name, secrets),
      description: tool.description
        ? redactSecretValues(tool.description, secrets)
        : undefined,
      inputSchema: redactInputSchema(tool.inputSchema, secrets),
    })),
  }
}

/** Redacted status map for secret ids referenced by a server. */
export function mcpServerSecretStatuses(
  config: McpServerConfig,
  secrets: Record<string, string>
): Record<string, McpSecretStatus> {
  const statuses: Record<string, McpSecretStatus> = {}
  for (const id of collectMcpServerSecretIds(config)) {
    const value = secrets[id]
    statuses[id] = value
      ? { configured: true, last4: value.slice(-4) }
      : { configured: false }
  }
  return statuses
}
