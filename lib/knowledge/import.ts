import { randomUUID } from "node:crypto"
import path from "node:path"

import { listProposals, saveProposal } from "../brain/store"
import type { BrainProposal } from "../brain/types"
import { checkDirectory, normalizeWorkspaceInput, readText, walkFiles } from "../fs-service"
import { inspectBundle, readBundleConcept, type IndexLevel } from "./bundle"
import type { BundlePreview, ObsidianPreview, ObsidianPreviewConcept, ObsidianQueueResult, PreviewLevel } from "./explain"
import {
  convertObsidianNotes,
  OBSIDIAN_NOTE_LIMIT,
  type ObsidianDraft,
  type ObsidianNoteInput,
} from "./obsidian"
import { OkfVersionError } from "./schema"
import { KnowledgePathError, assertConceptId, listConcepts, readConcept } from "./store"

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

async function requireFolder(folderPath: string): Promise<string> {
  return bundleRoot(folderPath)
}

async function readVaultNotes(vaultPath: string): Promise<ObsidianNoteInput[]> {
  const abs = await requireFolder(vaultPath)
  const notes: ObsidianNoteInput[] = []
  for (const rel of await walkFiles(abs)) {
    const posix = rel.split(/[/\\]/).join("/")
    if (posix.split("/").some((part) => part.startsWith("."))) continue
    if (!posix.toLowerCase().endsWith(".md")) continue
    const absolutePath = path.join(abs, rel)
    notes.push({
      relativePath: posix,
      absolutePath,
      content: await readText(absolutePath),
    })
  }
  if (notes.length > OBSIDIAN_NOTE_LIMIT) {
    throw new KnowledgeImportError(
      `This vault has ${notes.length} notes. BlackAgents reads up to ${OBSIDIAN_NOTE_LIMIT} at a time.`,
      400
    )
  }
  return notes
}

interface SavedIndex {
  ids: Set<string>
  bySource: Map<string, string>
  pendingIds: Set<string>
  pendingSources: Set<string>
}

async function savedIndex(workspaceRoot: string): Promise<SavedIndex> {
  const concepts = await listConcepts(workspaceRoot)
  const bySource = new Map<string, string>()
  for (const concept of concepts) {
    for (const source of concept.frontmatter.sources ?? []) bySource.set(source.resource, concept.id)
  }
  const pendingIds = new Set<string>()
  const pendingSources = new Set<string>()
  for (const proposal of await listProposals(workspaceRoot)) {
    if (proposal.status !== "pending" || proposal.target?.type !== "concept") continue
    pendingIds.add(proposal.target.name)
    for (const source of proposal.concept?.sources ?? []) pendingSources.add(source.resource)
  }
  return { ids: new Set(concepts.map((concept) => concept.id)), bySource, pendingIds, pendingSources }
}

function previewState(draft: ObsidianDraft, saved: SavedIndex): Pick<ObsidianPreviewConcept, "state" | "savedAs"> {
  if (draft.error) return { state: "invalid" }
  const source = draft.frontmatter.sources?.[0]?.resource
  const savedAs = saved.ids.has(draft.id) ? draft.id : source ? saved.bySource.get(source) : undefined
  if (savedAs) return { state: "saved", savedAs }
  if (saved.pendingIds.has(draft.id) || (source !== undefined && saved.pendingSources.has(source))) return { state: "pending" }
  return { state: "new" }
}

/** Read an Obsidian vault and show the concepts it would become. Writes nothing. */
export async function previewObsidianVault(workspaceRoot: string, vaultPath: string): Promise<ObsidianPreview> {
  const notes = await readVaultNotes(vaultPath)
  const drafts = convertObsidianNotes(notes, new Date())
  const saved = await savedIndex(workspaceRoot)
  return {
    path: await requireFolder(vaultPath),
    concepts: drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      description: draft.description,
      type: draft.frontmatter.type,
      folder: draft.folder,
      warnings: draft.warnings,
      error: draft.error,
      ...previewState(draft, saved),
    })),
  }
}

function queueProposal(workspaceRoot: string, draft: ObsidianDraft, now: string): BrainProposal {
  return {
    id: randomUUID(),
    kind: "new_concept",
    target: { type: "concept", name: draft.id },
    concept: draft.frontmatter,
    title: draft.title,
    rationale: "From an Obsidian vault. Approve it to save the concept.",
    content: draft.body,
    description: draft.description,
    source: { kind: "import", signal: "feedback" },
    decision: { by: "feedback" },
    status: "pending",
    createdAt: now,
  }
}

/**
 * Queue selected Obsidian notes into the inbox. The knowledge files are written
 * only when those proposals are approved.
 */
export async function queueObsidianConcepts(
  workspaceRoot: string,
  vaultPath: string,
  ids: string[]
): Promise<ObsidianQueueResult> {
  const drafts = convertObsidianNotes(await readVaultNotes(vaultPath), new Date())
  const byId = new Map(drafts.map((draft) => [draft.id, draft]))
  const saved = await savedIndex(workspaceRoot)
  const queued: ObsidianQueueResult["queued"] = []
  const skipped: ObsidianQueueResult["skipped"] = []

  for (const id of ids) {
    const draft = byId.get(id)
    if (!draft) {
      skipped.push({ id, reason: "Not in this vault" })
      continue
    }
    if (draft.error) {
      skipped.push({ id, reason: draft.error })
      continue
    }
    const state = previewState(draft, saved)
    if (state.state === "saved") {
      skipped.push({ id, reason: `Already saved as ${state.savedAs ?? id}` })
      continue
    }
    if (state.state === "pending") {
      skipped.push({ id, reason: "Already in the Inbox" })
      continue
    }
    try {
      assertConceptId(draft.id)
    } catch (err) {
      if (err instanceof KnowledgePathError) {
        skipped.push({ id, reason: err.message })
        continue
      }
      throw err
    }
    const proposal = queueProposal(workspaceRoot, draft, new Date().toISOString())
    await saveProposal(workspaceRoot, proposal)
    saved.pendingIds.add(draft.id)
    const source = draft.frontmatter.sources?.[0]?.resource
    if (source) saved.pendingSources.add(source)
    queued.push({ id: draft.id, title: draft.title })
  }

  return { queued, skipped }
}
