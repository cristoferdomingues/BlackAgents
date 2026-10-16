/** Plain-language help for Knowledge and the OKF export target (safe for the browser). */

/** Folder name of an exported OKF bundle, inside the destination. */
export const OKF_BUNDLE_DIR = "okf"

/** Maximum notes handled by one Obsidian preview/import. */
export const OBSIDIAN_NOTE_LIMIT = 1_000

export const OKF_EXPORT_LABEL = "OKF Bundle"

export const OKF_EXPORT_WHERE =
  "Files land under okf/ in the destination folder. These are knowledge concepts from the Brain, not agents or rules. Nothing is written until you export."

export const KNOWLEDGE_TAB_INTRO =
  "Durable facts from an OKF bundle, such as metrics and definitions. A preview only reads the folder. Add a concept to the Inbox, then approve it there to save it. Memory notes are separate: they are preferences, not these facts."

export const KNOWLEDGE_LIBRARY_INTRO =
  "Saved facts you can read. The assistant sees the title and the short line, and opens a concept only when it needs it."

export const KNOWLEDGE_LIBRARY_EMPTY =
  "No saved concepts yet. Approve one from the Inbox, or bring a folder in below."

export const KNOWLEDGE_VALIDATION_INTRO =
  "These Markdown files are not valid concepts yet. Fix the path or frontmatter, then check the folder again."

export const KNOWLEDGE_GRAPH_INTRO =
  "Each dot is a saved concept. A line means one concept links to another. Pulses show the direction of that link."

export const KNOWLEDGE_GRAPH_EMPTY =
  "No connections yet. Add links between saved concepts to build this graph."

export const OBSIDIAN_IMPORT_INTRO =
  "An Obsidian vault is turned into OKF concepts. Wikilinks become normal links. Nothing is saved until you approve each concept in the Inbox."

export const KNOWLEDGE_IMPORT_CHOICE = "Where the notes come from"

export const TRUST_LABEL = {
  unverified: "Not reviewed",
  "machine-confirmed": "Checked by a tool",
  "human-reviewed": "Reviewed by you",
} as const

export const STATUS_LABEL = {
  draft: "Draft",
  stable: "Stable",
  deprecated: "Old",
} as const

/** A short name for who produced a concept. */
export function actorLabel(by: string | undefined): string {
  if (!by) return "Unknown"
  if (by === "process:obsidian-import") return "Imported from Obsidian"
  if (by === "process:memory-promotion") return "Promoted from a memory note"
  if (by.startsWith("human:")) return "You"
  if (by.startsWith("process:")) return "Imported"
  return by
}

export interface KnowledgeGroup<T extends { title: string }> {
  folder: string
  label: string
  items: T[]
}

function folderLabel(folder: string): string {
  if (!folder) return "Top"
  return folder
    .split("/")
    .map((part) =>
      part
        .split("-")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    )
    .join(" / ")
}

/** Group concepts by folder for the library list. */
export function groupKnowledge<T extends { title: string; folder: string }>(items: T[]): KnowledgeGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const list = groups.get(item.folder) ?? []
    list.push(item)
    groups.set(item.folder, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, grouped]) => ({
      folder,
      label: folderLabel(folder),
      items: [...grouped].sort((a, b) => a.title.localeCompare(b.title)),
    }))
}

export interface PreviewEntry {
  title: string
  description: string
  kind: "concept" | "directory"
  target: string
}

export interface PreviewSection {
  heading: string
  entries: PreviewEntry[]
}

export interface PreviewLevel {
  dir: string
  sections: PreviewSection[]
}

export interface BundlePreview {
  path: string
  version?: string
  levels: PreviewLevel[]
  orphans: string[]
  missing: Array<{ href: string; target: string }>
}

export type ObsidianConceptState = "new" | "saved" | "pending" | "invalid"

export interface ObsidianPreviewConcept {
  id: string
  title: string
  description: string
  type: string
  folder: string
  warnings: string[]
  state: ObsidianConceptState
  /** Set when this note is already stored under a different id. */
  savedAs?: string
  error?: string
}

export interface ObsidianPreview {
  path: string
  concepts: ObsidianPreviewConcept[]
}

export interface ObsidianQueueResult {
  queued: Array<{ id: string; title: string }>
  skipped: Array<{ id: string; reason: string }>
}
