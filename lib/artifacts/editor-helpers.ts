import { STANDARDS_SPEC } from "../standards/default-standards"
import { hasSection, KEBAB_CASE_RE, RULE_MAX_CHARS, RULE_MAX_LINES } from "../standards/checks"
import type { ArtifactType } from "./types"

/** Isomorphic helpers for the artifact editor. */

/** When a rule is used: every request, when matching files are edited, or when asked for. */
export type RuleActivation = "always" | "files" | "request"

export function ruleActivationOf(alwaysApply: boolean, globs: readonly string[]): RuleActivation {
  if (alwaysApply) return "always"
  return globs.length > 0 ? "files" : "request"
}

/** The frontmatter values for an activation choice. Globs are kept only for "files". */
export function ruleFieldsFor(
  activation: RuleActivation,
  globs: readonly string[]
): { alwaysApply: boolean; globs: string[] } {
  if (activation === "always") return { alwaysApply: true, globs: [] }
  if (activation === "files") return { alwaysApply: false, globs: [...globs] }
  return { alwaysApply: false, globs: [] }
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from", "help", "helps", "i", "in",
  "into", "is", "it", "its", "make", "me", "my", "of", "on", "or", "our", "please", "should", "so",
  "that", "the", "their", "them", "this", "to", "use", "used", "uses", "we", "when", "which", "who",
  "will", "with", "you", "your", "agent", "rule", "skill", "command", "create", "write", "build",
])

const MAX_SUGGESTED_WORDS = 3
const MAX_NAME_CHARS = 40

/** A kebab-case name from free text ("Reviews PRs for security" → "reviews-prs-security"). */
export function suggestName(text: string): string {
  const words = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const meaningful = words.filter((w) => !STOP_WORDS.has(w))
  const picked = (meaningful.length > 0 ? meaningful : words).slice(0, MAX_SUGGESTED_WORDS)
  let name = picked.join("-")
  if (name.length > MAX_NAME_CHARS) name = name.slice(0, MAX_NAME_CHARS).replace(/-[^-]*$/, "")
  return name.replace(/^-+|-+$/g, "")
}

/** Lowercase kebab-case while the user types a name; keeps a trailing hyphen. */
export function toKebabWhileTyping(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
}

/** The first sentence of a description, for a short summary. */
export function firstSentence(text: string, max = 200): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  const end = trimmed.search(/[.!?](\s|$)/)
  const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1)
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence
}

export interface EditorCheck {
  id: string
  label: string
  ok: boolean
  /** "error" blocks a good artifact; "warning" is advice. */
  severity: "error" | "warning"
  hint?: string
}

/** The live checklist for the editor, in display order. */
export function editorChecks(input: {
  type: ArtifactType
  name: string
  description: string
  body: string
}): EditorCheck[] {
  const name = input.name.trim()
  const description = input.description.trim()
  const body = input.body
  const checks: EditorCheck[] = [
    {
      id: "name",
      label: "Name is kebab-case",
      ok: KEBAB_CASE_RE.test(name) && name.length <= 80,
      severity: "error",
      hint: "Use lowercase letters, digits and single hyphens.",
    },
    {
      id: "description",
      label: "Has a description",
      ok: description.length > 0,
      severity: "error",
    },
  ]
  if (input.type === "skill") {
    checks.push({
      id: "trigger",
      label: "Description says when to use it",
      ok: /\b(use|used|when|whenever|if)\b/i.test(description),
      severity: "warning",
      hint: "Start with “Use when …” so the assistant knows when to load it.",
    })
  }
  checks.push(
    {
      id: "body",
      label: "Has instructions",
      ok: body.trim().length > 0,
      severity: "error",
    },
    {
      id: "frontmatter",
      label: "No YAML frontmatter in the body",
      ok: !/^---\s*$/m.test(body.split("\n")[0] ?? ""),
      severity: "error",
      hint: "The app writes the frontmatter for you.",
    }
  )
  for (const section of STANDARDS_SPEC[input.type].requiredSections) {
    checks.push({
      id: `section:${section}`,
      label: `“${section}” section`,
      ok: hasSection(body, section),
      severity: input.type === "skill" ? "error" : "warning",
      hint: `Add a “## ${section}” heading.`,
    })
  }
  if (input.type === "rule") {
    const lines = body.trim().split("\n").length
    checks.push({
      id: "short",
      label: `Short (≤${RULE_MAX_LINES} lines)`,
      ok: lines <= RULE_MAX_LINES && body.length <= RULE_MAX_CHARS,
      severity: "error",
      hint: "Move long reference material into a skill.",
    })
  }
  return checks
}
