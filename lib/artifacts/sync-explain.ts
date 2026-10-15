import { PLATFORM_LAYOUTS } from "./layout"
import { SOURCE_ROOT } from "./source"
import type { Platform } from "./types"

/** Plain-language help for the Sync screen (isomorphic). */

export const SOURCE_HELP = `BlackAgents keeps your artifacts in ${SOURCE_ROOT}/. Each save also writes them to the IDE folders you turn on below, in each IDE's format.`

export const PLATFORM_ORDER = Object.keys(PLATFORM_LAYOUTS) as Platform[]

export function platformFolder(platform: Platform): string {
  return `${PLATFORM_LAYOUTS[platform].root}/`
}

export type SyncStatus = "in-sync" | "drifted" | "missing"

export const STATUS_LABEL: Record<SyncStatus, string> = {
  "in-sync": "in sync",
  drifted: "edited",
  missing: "missing",
}

export const STATUS_HELP: Record<SyncStatus, string> = {
  "in-sync": "The IDE file matches BlackAgents.",
  drifted: "Someone changed the IDE file by hand. Keep that change, or overwrite it with the BlackAgents version.",
  missing: "This IDE folder has no copy yet. Export to create it.",
}

/** One line under the export switches. */
export function targetsSummary(targets: Platform[], saved: boolean): string {
  if (targets.length === 0) {
    return "Saves stay only in BlackAgents. Your IDEs will not see changes."
  }
  const names = targets.map((p) => PLATFORM_LAYOUTS[p].label).join(", ")
  return saved
    ? `Each save updates ${names}.`
    : `Each save updates ${names}. These are the IDE folders found in this workspace; change them any time.`
}

/** Text for the IDE-only list. */
export function ideOnlySummary(count: number): string {
  if (count === 0) return "Every artifact is in BlackAgents."
  const what = count === 1 ? "1 artifact is" : `${count} artifacts are`
  return `${what} only in IDE folders. Move them into BlackAgents to edit them here and export them everywhere. Nothing is deleted.`
}
