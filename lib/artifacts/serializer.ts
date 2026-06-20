import matter from "gray-matter"

import { artifactDeletePath, artifactRelPath } from "./layout"
import { normalizeExtra, type ArtifactInput } from "./schemas"
import type { ArtifactType } from "./types"

/** Compose the ordered frontmatter object for an artifact type. */
function frontmatterFor(input: ArtifactInput): Record<string, unknown> {
  const extra = normalizeExtra(input.type, input.extra)
  switch (input.type) {
    case "rule":
      // Rules conventionally omit `name`; keep description first.
      return { description: input.description, ...extra }
    case "agent":
    case "command":
    case "skill":
    default:
      return { name: input.name, description: input.description, ...extra }
  }
}

export interface SerializedArtifact {
  /** Path (relative to workspace root) of the primary file to write. */
  relPath: string
  /** Path to remove on delete (the skill directory for nested types). */
  deletePath: string
  /** Full file content including the frontmatter block. */
  content: string
}

export function serializeArtifact(input: ArtifactInput): SerializedArtifact {
  const data = frontmatterFor(input)
  const body = input.body.trim()
  const content = matter.stringify(body ? `\n${body}\n` : "\n", data)
  return {
    relPath: artifactRelPath(input.platform, input.type, input.name),
    deletePath: artifactDeletePath(input.platform, input.type, input.name),
    content,
  }
}

/** Paths for an existing artifact identified by type + name on a platform. */
export function artifactPaths(
  platform: ArtifactInput["platform"],
  type: ArtifactType,
  name: string
) {
  return {
    relPath: artifactRelPath(platform, type, name),
    deletePath: artifactDeletePath(platform, type, name),
  }
}
