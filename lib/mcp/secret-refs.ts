/**
 * `${secret:id}` placeholders in MCP header/env values.
 * Real values live in ~/.black-agents/secrets.json (never in .black-agents/mcp.json).
 */

export const MCP_SECRET_REF_PATTERN = /\$\{secret:([a-zA-Z0-9._-]+)\}/g

const FULL_SECRET_REF = /^\$\{secret:([a-zA-Z0-9._-]+)\}$/

/** Build a stable secret id for a server header or env var. */
export function mcpSecretId(
  serverName: string,
  kind: "header" | "env",
  key: string
): string {
  return `mcp.${serverName}.${kind}.${key}`
}

/** Format a value that is entirely one secret reference. */
export function formatSecretRef(id: string): string {
  return `\${secret:${id}}`
}

/** True when the whole string is a single `${secret:id}` ref. */
export function isFullSecretRef(value: string): boolean {
  return FULL_SECRET_REF.test(value.trim())
}

/** Extract the id from a full `${secret:id}` value, or null. */
export function parseFullSecretRef(value: string): string | null {
  const match = FULL_SECRET_REF.exec(value.trim())
  return match?.[1] ?? null
}

/** Collect every secret id referenced in a string (including embedded refs). */
export function findSecretRefs(value: string): string[] {
  const ids: string[] = []
  const re = new RegExp(MCP_SECRET_REF_PATTERN.source, "g")
  for (const match of value.matchAll(re)) {
    const id = match[1]
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Replace `${secret:id}` placeholders with values from the map.
 * Throws when a referenced id is missing or empty.
 */
export function resolveSecretRefs(
  value: string,
  secrets: Record<string, string>
): string {
  return value.replace(MCP_SECRET_REF_PATTERN, (_full, id: string) => {
    const resolved = secrets[id]
    if (!resolved) {
      throw new Error(
        `MCP secret "${id}" is not configured. Add it in Settings → MCP Servers.`
      )
    }
    return resolved
  })
}
