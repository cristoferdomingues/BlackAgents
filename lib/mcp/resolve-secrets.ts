import {
  findSecretRefs,
  resolveSecretRefs,
} from "@/lib/mcp/secret-refs"
import type { McpSecretStatus, McpServerConfig } from "@/lib/mcp/types"

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
