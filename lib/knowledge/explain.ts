/** Plain-language help for Knowledge and the OKF export target (safe for the browser). */

/** Folder name of an exported OKF bundle, inside the destination. */
export const OKF_BUNDLE_DIR = "okf"

export const OKF_EXPORT_LABEL = "OKF Bundle"

export const OKF_EXPORT_WHERE =
  "Files land under okf/ in the destination folder. These are knowledge concepts from the Brain, not agents or rules. Nothing is written until you export."

export const KNOWLEDGE_TAB_INTRO =
  "Durable facts from an OKF bundle, such as metrics and definitions. A preview only reads the folder. Add a concept to the Inbox, then approve it there to save it. Memory notes are separate: they are preferences, not these facts."

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
