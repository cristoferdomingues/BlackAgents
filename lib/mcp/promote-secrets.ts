import {
  formatSecretRef,
  mcpSecretId,
  parseFullSecretRef,
} from "@/lib/mcp/secret-refs"
import type { McpServerConfig } from "@/lib/mcp/types"

export interface PromoteMcpSecretsInput {
  serverName: string
  config: McpServerConfig
  /** Header names whose values should move into secrets.json. */
  secretHeaders?: string[]
  /** Env keys whose values should move into secrets.json. */
  secretEnv?: string[]
  /** Already-stored MCP secrets (id → value). */
  existingSecrets: Record<string, string>
}

export type PromoteMcpSecretsResult =
  | {
      ok: true
      config: McpServerConfig
      /** New or updated secret values to persist. */
      upserts: Record<string, string>
    }
  | { ok: false; error: string }

function promoteMap(
  serverName: string,
  kind: "header" | "env",
  values: Record<string, string>,
  secretKeys: string[] | undefined,
  existingSecrets: Record<string, string>,
  upserts: Record<string, string>
): { ok: true; next: Record<string, string> } | { ok: false; error: string } {
  if (!secretKeys || secretKeys.length === 0) {
    return { ok: true, next: { ...values } }
  }

  const secretKeySet = new Set(secretKeys)
  const next: Record<string, string> = { ...values }

  for (const key of secretKeySet) {
    const current = values[key]
    if (current === undefined) {
      return {
        ok: false,
        error: `Cannot store secret for ${kind} "${key}" — it is not set on the server`,
      }
    }

    const id = mcpSecretId(serverName, kind, key)
    const existingRef = parseFullSecretRef(current)
    if (existingRef) {
      if (!existingSecrets[existingRef] && !upserts[existingRef]) {
        return {
          ok: false,
          error: `MCP secret "${existingRef}" is not configured`,
        }
      }
      next[key] = formatSecretRef(existingRef)
      continue
    }

    const trimmed = current.trim()
    if (!trimmed) {
      if (existingSecrets[id]) {
        next[key] = formatSecretRef(id)
        continue
      }
      return {
        ok: false,
        error: `A value is required for secret ${kind} "${key}"`,
      }
    }

    upserts[id] = current
    next[key] = formatSecretRef(id)
  }

  return { ok: true, next }
}

/**
 * Move selected header/env values into secrets.json and leave `${secret:id}`
 * placeholders in the workspace mcp.json config.
 */
export function promoteMcpSecrets(
  input: PromoteMcpSecretsInput
): PromoteMcpSecretsResult {
  const upserts: Record<string, string> = {}

  const headersResult = promoteMap(
    input.serverName,
    "header",
    input.config.headers ?? {},
    input.secretHeaders,
    input.existingSecrets,
    upserts
  )
  if (!headersResult.ok) return headersResult

  const envResult = promoteMap(
    input.serverName,
    "env",
    input.config.env ?? {},
    input.secretEnv,
    input.existingSecrets,
    upserts
  )
  if (!envResult.ok) return envResult

  return {
    ok: true,
    config: {
      ...input.config,
      headers: headersResult.next,
      env: envResult.next,
    },
    upserts,
  }
}

/** Secret ids that belong to a given MCP server name. */
export function mcpSecretIdsForServer(
  serverName: string,
  allIds: string[]
): string[] {
  const prefix = `mcp.${serverName}.`
  return allIds.filter((id) => id.startsWith(prefix))
}
