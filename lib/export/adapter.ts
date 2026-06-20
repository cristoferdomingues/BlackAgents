import matter from "gray-matter"

import { artifactRelPath } from "../artifacts/layout"
import type { Artifact, Platform } from "../artifacts/types"

/**
 * Multi-platform export adapter.
 *
 * Because the in-memory model is platform-agnostic, "exporting" an artifact to
 * another tool is just re-deriving its file path (via the layout map) and
 * re-emitting the frontmatter + body. This is the seam a future export UI
 * (write-to-disk or .zip download) builds on; the data transform already works.
 */

export interface ExportFile {
  path: string
  content: string
}

export function artifactToFile(
  artifact: Artifact,
  targetPlatform: Platform
): ExportFile {
  const data: Record<string, unknown> = { ...artifact.frontmatter }
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
