export interface McpHeaderRow {
  name: string
  value: string
}

export type CollectMcpHeadersResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; error: string }

/**
 * A header that is not stored as a secret still needs a value.
 * Secret headers may be blank so an edit can keep the stored secret.
 */
export function blankPlainHeaderError(
  headers: Record<string, string> | undefined,
  secretHeaders: string[] | undefined
): string | null {
  const secretNames = new Set(secretHeaders ?? [])
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!value.trim() && !secretNames.has(name)) {
      return "Header value is required"
    }
  }
  return null
}

/**
 * Turn header rows from the settings form into a header map.
 * Blank rows are skipped. A row needs both a name and a value.
 */
export function collectMcpHeaders(rows: McpHeaderRow[]): CollectMcpHeadersResult {
  const headers: Record<string, string> = {}

  for (const row of rows) {
    const name = row.name.trim()
    const value = row.value
    if (!name && !value.trim()) continue
    if (!name || !value.trim()) {
      return { ok: false, error: "Each header needs a name and a value" }
    }
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      return { ok: false, error: `Header name "${name}" is not valid` }
    }
    if (/[\r\n]/.test(value)) {
      return { ok: false, error: "Header value cannot contain line breaks" }
    }
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      return { ok: false, error: `Header "${name}" is listed twice` }
    }
    headers[name] = value
  }

  return { ok: true, headers }
}
