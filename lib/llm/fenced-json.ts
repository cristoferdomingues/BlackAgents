/**
 * Find and parse the fenced JSON blocks the assistant emits (```artifact,
 * ```bundle, ```workflow). Isomorphic. Models often break strict JSON in long
 * Markdown bodies (real line breaks inside strings, code fences inside the
 * body), so parsing is forgiving about those two things only.
 */

export interface FencedJsonBlock {
  /** Index of the opening fence. */
  start: number
  /** Index just after the closing fence (or the text end when unclosed). */
  end: number
  closed: boolean
  /** Parsed JSON, or undefined when no candidate parsed. */
  value: unknown
}

/** Escape raw control characters inside JSON string literals. */
export function repairJsonStrings(raw: string): string {
  let out = ""
  let inString = false
  let escaped = false
  for (const ch of raw) {
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (escaped) {
      escaped = false
      out += ch
      continue
    }
    if (ch === "\\") {
      escaped = true
      out += ch
      continue
    }
    if (ch === '"') {
      inString = false
      out += ch
      continue
    }
    const code = ch.charCodeAt(0)
    if (ch === "\n") out += "\\n"
    else if (ch === "\r") out += "\\r"
    else if (ch === "\t") out += "\\t"
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`
    else out += ch
  }
  return out
}

export function parseLenientJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    try {
      return { ok: true, value: JSON.parse(repairJsonStrings(raw)) as unknown }
    } catch {
      return { ok: false }
    }
  }
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The first ```<fence> block at or after `from`. A body may contain its own
 * ``` lines, so every bare closing fence is tried until the content parses.
 */
export function findFencedJson(text: string, fence: string, from = 0): FencedJsonBlock | null {
  const open = new RegExp("```" + escapeRe(fence) + "[ \\t]*\\r?\\n", "ig")
  open.lastIndex = from
  const opened = open.exec(text)
  if (!opened) return null
  const start = opened.index
  const bodyStart = start + opened[0].length
  const close = /\r?\n```[ \t]*(?=\r?\n|$)/g
  close.lastIndex = bodyStart - 1
  let first: { index: number; end: number } | null = null
  for (let m = close.exec(text); m; m = close.exec(text)) {
    const end = m.index + m[0].length
    first ??= { index: m.index, end }
    const parsed = parseLenientJson(text.slice(bodyStart, m.index))
    if (parsed.ok) return { start, end, closed: true, value: parsed.value }
  }
  if (first) return { start, end: first.end, closed: true, value: undefined }
  const rest = parseLenientJson(text.slice(bodyStart))
  return { start, end: text.length, closed: false, value: rest.ok ? rest.value : undefined }
}

/** Remove every ```<fence> block (valid or not) from the text. */
export function stripFencedBlocks(text: string, fence: string): string {
  let out = ""
  let cursor = 0
  for (let block = findFencedJson(text, fence); block; block = findFencedJson(text, fence, cursor)) {
    out += text.slice(cursor, block.start)
    cursor = block.end
  }
  return (out + text.slice(cursor)).trim()
}
