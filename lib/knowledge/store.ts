import path from "node:path"

import { inheritsScopeToken } from "../artifacts/projects"
import { pathExists, readText, resolveInWorkspace, walkFiles, writeText } from "../fs-service"
import { renderConceptFile } from "./export"
import { parseConceptContent, type OkfConcept } from "./parse"
import type { OkfConceptFrontmatter } from "./schema"

/**
 * Workspace knowledge lives only in `.black-agents/knowledge/`. The concept id
 * is the file path inside that folder, without `.md`. Writes belong to the
 * Brain approval flow; nothing else should call `writeConcept`.
 *
 * Knowledge is never *stored* in a project, but a project can be whitelisted
 * to see the workspace registry (`inherits: ["knowledge"]`). Without the token
 * the registry resolves to nothing (fail closed); with it, concepts are
 * read-only — only the Inbox approval flow may mark them verified.
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

export interface KnowledgeFileIssue {
  file: string
  reason: string
}

export interface KnowledgeStoreInspection {
  concepts: OkfConcept[]
  issues: KnowledgeFileIssue[]
}

/**
 * Read every concept and report invalid Markdown files instead of hiding them.
 * With `scope`, the registry is only visible when the `knowledge` token is
 * whitelisted in the project's `project.json` (fail closed otherwise).
 */
export async function inspectKnowledgeStore(
  workspaceRoot: string,
  scope?: string
): Promise<KnowledgeStoreInspection> {
  if (scope && !(await inheritsScopeToken(workspaceRoot, scope, "knowledge"))) {
    return { concepts: [], issues: [] }
  }
  const dir = resolveInWorkspace(workspaceRoot, KNOWLEDGE_DIR)
  if (!(await pathExists(dir))) return { concepts: [], issues: [] }
  const concepts: OkfConcept[] = []
  const issues: KnowledgeFileIssue[] = []
  for (const rel of (await walkFiles(dir)).sort()) {
    const normalized = rel.split(path.sep).join("/")
    if (!normalized.endsWith(".md")) continue
    const base = path.posix.basename(normalized)
    if (base === "index.md" || base === "log.md") continue
    const id = conceptIdFromRel(rel)
    if (!id) {
      issues.push({
        file: `${KNOWLEDGE_DIR}/${normalized}`,
        reason: "The path must use kebab-case folders and a kebab-case .md file name.",
      })
      continue
    }
    const parsed = parseConceptContent(id, await readText(path.join(dir, rel)))
    if (parsed.ok) {
      concepts.push(parsed.concept)
    } else {
      issues.push({ file: `${KNOWLEDGE_DIR}/${normalized}`, reason: parsed.message })
    }
  }
  return { concepts, issues }
}

export async function listConcepts(
  workspaceRoot: string,
  scope?: string
): Promise<OkfConcept[]> {
  return (await inspectKnowledgeStore(workspaceRoot, scope)).concepts
}

export async function readConcept(
  workspaceRoot: string,
  id: string,
  scope?: string
): Promise<OkfConcept | null> {
  if (scope && !(await inheritsScopeToken(workspaceRoot, scope, "knowledge"))) {
    return null
  }
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
  const content = renderConceptFile(input)
  await writeText(resolveInWorkspace(workspaceRoot, conceptRelPath(input.id)), content)
  const saved = await readConcept(workspaceRoot, input.id)
  if (!saved) throw new KnowledgePathError(`The concept "${input.id}" was not saved`)
  return saved
}
