import type { StandardsIssue } from "../standards/checks"
import { linkedConceptIds } from "./links"

/**
 * Concept rules checked before a proposal is saved. Broken links are warnings:
 * OKF allows links to concepts that are not written yet.
 */

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export { linkedConceptIds }

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

