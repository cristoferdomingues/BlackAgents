import { safeParseMatter } from "../artifacts/parser"
import { normalizeFrontmatter, type OkfConceptFrontmatter, type OkfWarning } from "./schema"

/** One concept read from markdown. `id` is the path with `.md` removed. */
export interface OkfConcept {
  id: string
  frontmatter: OkfConceptFrontmatter
  body: string
  warnings: OkfWarning[]
}

export type ConceptParse = { ok: true; concept: OkfConcept } | { ok: false; message: string }

/** Parse one concept file. Frontmatter goes through the shared artifact parser. */
export function parseConceptContent(id: string, raw: string): ConceptParse {
  const parsed = safeParseMatter(raw)
  if (!raw.trim()) return { ok: false, message: "The concept file is empty" }
  const normalized = normalizeFrontmatter(parsed.data, parsed.content)
  if ("error" in normalized) return { ok: false, message: normalized.error }
  return {
    ok: true,
    concept: {
      id,
      frontmatter: normalized.frontmatter,
      body: parsed.content.replace(/^\n+/, ""),
      warnings: normalized.warnings,
    },
  }
}
