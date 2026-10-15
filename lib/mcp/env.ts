export interface McpEnvRow {
  name: string
  value: string
}

export type CollectMcpEnvResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; error: string }

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Turn environment rows from the settings form into an env map.
 * Blank rows are skipped. A row needs both a name and a value.
 * Values are meant to be stored as secrets, not written in mcp.json.
 */
export function collectMcpEnv(rows: McpEnvRow[]): CollectMcpEnvResult {
  const env: Record<string, string> = {}

  for (const row of rows) {
    const name = row.name.trim()
    const value = row.value
    if (!name && !value.trim()) continue
    if (!name || !value.trim()) {
      return { ok: false, error: "Each variable needs a name and a value" }
    }
    if (!ENV_NAME.test(name)) {
      return {
        ok: false,
        error: `Variable name "${name}" is not valid. Use letters, numbers, and underscores.`,
      }
    }
    if (/[\r\n]/.test(value)) {
      return { ok: false, error: "Variable value cannot contain line breaks" }
    }
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      return { ok: false, error: `Variable "${name}" is listed twice` }
    }
    env[name] = value
  }

  return { ok: true, env }
}
