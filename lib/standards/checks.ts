import type { ArtifactType } from "../artifacts/types"
import { STANDARDS_SPEC } from "./default-standards"

/**
 * Deterministic authoring-standards checks (isomorphic). Used to validate
 * model-drafted bundles and Second Brain proposals before the user saves them.
 */

export const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const RULE_MAX_LINES = 40
export const RULE_MAX_CHARS = 4_000

export interface StandardsIssue {
  severity: "error" | "warning"
  message: string
}

export interface CheckableArtifact {
  type: ArtifactType
  name: string
  description: string
  body: string
}

function hasSection(body: string, section: string): boolean {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^#{1,6}\\s+${escaped}\\b`, "im").test(body)
}

export function checkArtifactStandards(artifact: CheckableArtifact): StandardsIssue[] {
  const issues: StandardsIssue[] = []
  if (!KEBAB_CASE_RE.test(artifact.name) || artifact.name.length > 80) {
    issues.push({ severity: "error", message: "Name must be kebab-case (max 80 chars)" })
  }
  if (!artifact.description.trim()) {
    issues.push({ severity: "error", message: "Description is required" })
  }
  if (!artifact.body.trim()) {
    issues.push({ severity: "error", message: "Body is empty" })
  }
  if (/^---\s*$/m.test(artifact.body.split("\n")[0] ?? "")) {
    issues.push({ severity: "error", message: "Body must not include YAML frontmatter" })
  }

  const required = STANDARDS_SPEC[artifact.type].requiredSections
  for (const section of required) {
    if (hasSection(artifact.body, section)) continue
    issues.push({
      // A skill without "When to Apply" cannot be loaded at the right time.
      severity: artifact.type === "skill" ? "error" : "warning",
      message: `Missing "## ${section}" section`,
    })
  }

  if (artifact.type === "rule") {
    const lines = artifact.body.trim().split("\n").length
    if (lines > RULE_MAX_LINES || artifact.body.length > RULE_MAX_CHARS) {
      issues.push({
        severity: "error",
        message: `Rules must stay short (≤${RULE_MAX_LINES} lines, ≤${RULE_MAX_CHARS} chars); move detail to a skill`,
      })
    }
  }
  return issues
}

export function hasErrors(issues: StandardsIssue[]): boolean {
  return issues.some((i) => i.severity === "error")
}
