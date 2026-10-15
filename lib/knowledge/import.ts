import { randomUUID } from "node:crypto"

import { saveProposal } from "../brain/store"
import type { BrainProposal } from "../brain/types"
import { checkDirectory, normalizeWorkspaceInput } from "../fs-service"
import { inspectBundle, readBundleConcept, type IndexLevel } from "./bundle"
import type { BundlePreview, PreviewLevel } from "./explain"
import { OkfVersionError } from "./schema"
import { KnowledgePathError, assertConceptId, readConcept } from "./store"

/**
 * Preview an OKF folder without writing. Queueing reads one concept into the
 * Brain inbox. The knowledge file is written only when that proposal is approved.
 */

export class KnowledgeImportError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "KnowledgeImportError"
  }
}

export type { BundlePreview }

function levelView(level: IndexLevel): PreviewLevel {
  return {
    dir: level.dir,
    sections: level.sections.map((section) => ({
      heading: section.heading,
      entries: section.entries.map((entry) => ({
        title: entry.title,
        description: entry.description,
        kind: entry.kind,
        target: entry.target,
      })),
    })),
  }
}

async function bundleRoot(bundlePath: string): Promise<string> {
  const abs = normalizeWorkspaceInput(bundlePath)
  const check = await checkDirectory(abs)
  if (!check.exists) throw new KnowledgeImportError(`Folder not found: ${abs}`, 404)
  if (!check.isDirectory) throw new KnowledgeImportError(`Not a folder: ${abs}`, 400)
  return abs
}

/** Read the indexes of a bundle. Concept bodies stay on disk. */
export async function previewBundle(bundlePath: string): Promise<BundlePreview> {
  const abs = await bundleRoot(bundlePath)
  try {
    const report = await inspectBundle(abs)
    return {
      path: abs,
      version: report.version,
      levels: report.levels.filter((level) => level.present).map(levelView),
      orphans: report.orphans,
      missing: report.missing.map((link) => ({ href: link.href, target: link.target })),
    }
  } catch (err) {
    if (err instanceof OkfVersionError) throw new KnowledgeImportError(err.message, 400)
    throw err
  }
}

/** Copy one concept into a pending inbox proposal. Does not write the knowledge file. */
export async function queueConcept(workspaceRoot: string, bundlePath: string, id: string): Promise<BrainProposal> {
  const abs = await bundleRoot(bundlePath)
  try {
    assertConceptId(id)
  } catch (err) {
    if (err instanceof KnowledgePathError) throw new KnowledgeImportError(err.message, 400)
    throw err
  }
  const parsed = await readBundleConcept(abs, id)
  if (!parsed.ok) throw new KnowledgeImportError(parsed.message, 400)
  if (await readConcept(workspaceRoot, id)) {
    throw new KnowledgeImportError(`The concept "${id}" is already in this workspace`, 409)
  }

  const now = new Date().toISOString()
  const proposal: BrainProposal = {
    id: randomUUID(),
    kind: "new_concept",
    target: { type: "concept", name: id },
    concept: parsed.concept.frontmatter,
    title: parsed.concept.frontmatter.title ?? id,
    rationale: "From an OKF bundle. Approve it to save the concept.",
    content: parsed.concept.body,
    description: parsed.concept.frontmatter.description,
    source: { kind: "import", signal: "feedback" },
    decision: { by: "feedback" },
    status: "pending",
    createdAt: now,
  }
  await saveProposal(workspaceRoot, proposal)
  return proposal
}
