import type { StandardsIssue } from "../standards/checks"

/**
 * Concept rules checked before a proposal is saved. Broken links are warnings:
 * OKF allows links to concepts that are not written yet.
 */

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g

export function checkConceptStandards(input: {
  id: string
  type: string | undefined
  staleAfter?: string
  body: string
  knownIds: readonly string[]
}): StandardsIssue[] {
  const issues: StandardsIssue[] = []
  if (!input.type?.trim()) {
    issues.push({ severity: "error", message: "type is required" })
  }
  const segments = input.id.split("/")
  if (
    input.id !== input.id.trim() ||
    segments.length === 0 ||
    segments.some((segment) => !SEGMENT.test(segment))
  ) {
    issues.push({
      severity: "error",
      message: `Concept id "${input.id}" must be kebab-case path segments, like crypto/portfolio-metrics`,
    })
  }
  if (input.staleAfter !== undefined && !ISO_DATE_TIME.test(input.staleAfter)) {
    issues.push({ severity: "error", message: "stale_after must be an ISO 8601 datetime" })
  }
  const known = new Set(input.knownIds)
  known.add(input.id)
  for (const target of linkedConceptIds(input.id, input.body)) {
    if (!known.has(target)) {
      issues.push({ severity: "warning", message: `Link to "${target}" does not resolve` })
    }
  }
  return issues
}

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

/** Concept id for one markdown href, or null when it is not a concept link. */
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

/** Concept ids linked from a markdown body. External and directory links are skipped. */
export function linkedConceptIds(fromId: string, body: string): string[] {
  const dir = fromId.includes("/") ? fromId.slice(0, fromId.lastIndexOf("/")) : ""
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of body.matchAll(LINK_RE)) {
    const target = conceptIdFromHref(dir, match[1] ?? "")
    if (!target || seen.has(target)) continue
    seen.add(target)
    ids.push(target)
  }
  return ids
}
