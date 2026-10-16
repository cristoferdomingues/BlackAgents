/**
 * Markdown links between concepts. Safe to import from the browser.
 * External links and links to index.md or log.md are not concepts.
 */

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g

function normalizePosix(value: string): string {
  const parts: string[] = []
  for (const part of value.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return ".."
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

function conceptIdFromHref(dir: string, href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || /^[a-z]+:/i.test(trimmed)) return null
  const decoded = trimmed.split("#")[0]?.split("?")[0] ?? ""
  if (!decoded) return null
  const base = decoded.startsWith("/") ? decoded.slice(1) : dir ? `${dir}/${decoded}` : decoded
  const normalized = normalizePosix(base)
  if (!normalized || normalized.startsWith("..")) return null
  if (normalized.endsWith("/") || normalized === "index.md" || normalized.endsWith("/index.md")) return null
  if (!normalized.endsWith(".md")) return null
  const id = normalized.slice(0, -".md".length)
  const name = id.split("/").at(-1)
  if (name === "log") return null
  return id
}

/** Concept id a markdown link points at, relative to the concept that contains it. */
export function conceptLinkTarget(fromId: string, href: string): string | null {
  const dir = fromId.includes("/") ? fromId.slice(0, fromId.lastIndexOf("/")) : ""
  return conceptIdFromHref(dir, href)
}

/** Concept ids linked from a markdown body. External and directory links are skipped. */
export function linkedConceptIds(fromId: string, body: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of body.matchAll(LINK_RE)) {
    const target = conceptLinkTarget(fromId, match[1] ?? "")
    if (!target || seen.has(target)) continue
    seen.add(target)
    ids.push(target)
  }
  return ids
}
