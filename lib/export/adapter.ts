import matter from "gray-matter"

import { artifactRelPath } from "../artifacts/layout"
import type { Artifact, Platform } from "../artifacts/types"

/**
 * Multi-platform export adapter.
 *
 * The in-memory model is platform-agnostic, so "exporting" an artifact means
 * two things: re-deriving its file path from the layout map, and re-emitting
 * frontmatter in the *target* platform's dialect. The frontmatter mapping is
 * the substance here — platforms diverge on rule activation, naming, and which
 * keys they understand.
 */

export interface ExportFile {
  path: string
  content: string
}

export type ExportStatus = "create" | "overwrite" | "unchanged"

/**
 * Re-express an artifact's frontmatter in the target platform's conventions.
 *
 * Canonical fields (`name`, `description`) plus the type-specific extras
 * (`parallel`, `alwaysApply`, `globs`) are mapped to each platform's keys.
 * Keys are inserted in display order (name → description → extras).
 */
export function frontmatterFor(
  platform: Platform,
  artifact: Artifact
): Record<string, unknown> {
  const { type, name, description, frontmatter } = artifact
  const globs = Array.isArray(frontmatter.globs) ? frontmatter.globs : []
  const fm: Record<string, unknown> = {}

  switch (platform) {
    case "cursor": {
      // Cursor rules are identified by filename and omit `name`.
      if (type !== "rule") fm.name = name
      if (description) fm.description = description
      if (type === "agent" && frontmatter.parallel) fm.parallel = true
      if (type === "rule") {
        if (frontmatter.alwaysApply) fm.alwaysApply = true
        if (globs.length > 0) fm.globs = globs
      }
      return fm
    }

    case "claude": {
      // Claude understands name + description; it has no rule activation keys.
      if (type === "agent" || type === "skill") fm.name = name
      if (description) fm.description = description
      return fm
    }

    case "windsurf": {
      if (type === "skill") fm.name = name
      if (description) fm.description = description
      if (type === "rule") {
        // Map Cursor activation onto Windsurf's `trigger` field.
        if (frontmatter.alwaysApply) {
          fm.trigger = "always_on"
        } else if (globs.length > 0) {
          fm.trigger = "glob"
          fm.globs = globs
        } else {
          fm.trigger = "manual"
        }
      }
      return fm
    }

    default:
      return fm
  }
}

export function artifactToFile(
  artifact: Artifact,
  targetPlatform: Platform
): ExportFile {
  const data = frontmatterFor(targetPlatform, artifact)
  const body = artifact.body.trim()
  const content = matter.stringify(body ? `\n${body}\n` : "\n", data)
  return {
    path: artifactRelPath(targetPlatform, artifact.type, artifact.name),
    content,
  }
}

export function buildExportManifest(
  artifacts: Artifact[],
  targetPlatform: Platform
): ExportFile[] {
  return artifacts.map((a) => artifactToFile(a, targetPlatform))
}

/** Compare proposed content against what (if anything) is already on disk. */
export function fileStatus(existing: string | null, next: string): ExportStatus {
  if (existing === null) return "create"
  return existing === next ? "unchanged" : "overwrite"
}
