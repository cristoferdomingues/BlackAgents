import matter from "gray-matter"
import path from "node:path"

import { pathExists, readText, resolveInWorkspace, walkFiles, writeText } from "../fs-service"
import { parseConceptContent, type OkfConcept } from "./parse"
import type { OkfConceptFrontmatter } from "./schema"

/**
 * Workspace knowledge lives only in `.black-agents/knowledge/`. The concept id
 * is the file path inside that folder, without `.md`. Writes belong to the
 * Brain approval flow; nothing else should call `writeConcept`.
 */

export const KNOWLEDGE_DIR = ".black-agents/knowledge"

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/

export class KnowledgePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "KnowledgePathError"
  }
}

/** Reject ids that leave the knowledge folder or use a non-kebab segment. */
export function assertConceptId(id: string): void {
  const segments = id.split("/")
  if (id !== id.trim() || segments.length === 0 || segments.some((segment) => !SEGMENT.test(segment))) {
    throw new KnowledgePathError(`Concept id "${id}" must be kebab-case path segments, like crypto/portfolio-metrics`)
  }
}

export function conceptRelPath(id: string): string {
  assertConceptId(id)
  return `${KNOWLEDGE_DIR}/${id}.md`
}

/** Concept id from a path relative to the knowledge folder. Reserved files have none. */
export function conceptIdFromRel(relPath: string): string | null {
  const normalized = relPath.split(path.sep).join("/")
  if (!normalized.endsWith(".md")) return null
  const base = path.posix.basename(normalized)
  if (base === "index.md" || base === "log.md") return null
  const id = normalized.slice(0, -".md".length)
  try {
    assertConceptId(id)
  } catch {
    return null
  }
  return id
}

export async function listConcepts(workspaceRoot: string): Promise<OkfConcept[]> {
  const dir = resolveInWorkspace(workspaceRoot, KNOWLEDGE_DIR)
  if (!(await pathExists(dir))) return []
  const concepts: OkfConcept[] = []
  for (const rel of (await walkFiles(dir)).sort()) {
    const id = conceptIdFromRel(rel)
    if (!id) continue
    const parsed = parseConceptContent(id, await readText(path.join(dir, rel)))
    if (parsed.ok) concepts.push(parsed.concept)
  }
  return concepts
}

export async function readConcept(workspaceRoot: string, id: string): Promise<OkfConcept | null> {
  const abs = resolveInWorkspace(workspaceRoot, conceptRelPath(id))
  if (!(await pathExists(abs))) return null
  const parsed = parseConceptContent(id, await readText(abs))
  if (!parsed.ok) throw new KnowledgePathError(parsed.message)
  return parsed.concept
}

/** The only write into `.black-agents/knowledge/`. Call it from Brain approval. */
export async function writeConcept(
  workspaceRoot: string,
  input: { id: string; frontmatter: OkfConceptFrontmatter; body: string }
): Promise<OkfConcept> {
  const { extra, ...frontmatter } = input.frontmatter
  const data: Record<string, unknown> = { ...frontmatter, ...extra }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) delete data[key]
  }
  const body = input.body.trim()
  const content = matter.stringify(body ? `\n${body}\n` : "\n", data)
  await writeText(resolveInWorkspace(workspaceRoot, conceptRelPath(input.id)), content)
  const saved = await readConcept(workspaceRoot, input.id)
  if (!saved) throw new KnowledgePathError(`The concept "${input.id}" was not saved`)
  return saved
}
