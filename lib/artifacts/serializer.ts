import matter from "gray-matter"

import { artifactDeletePath, artifactRelPath } from "./layout"
import { normalizeExtra, type ArtifactInput } from "./schemas"
import type { Artifact, ArtifactType } from "./types"

/** Compose the ordered frontmatter object for an artifact type. */
function frontmatterFor(
  input: ArtifactInput,
  existingFrontmatter?: Record<string, unknown>
): Record<string, unknown> {
  const extra = normalizeExtra(input.type, input.extra)
  const base = existingFrontmatter ? { ...existingFrontmatter } : {}
  delete base.name
  delete base.description
  delete base.parallel
  delete base.alwaysApply
  delete base.globs
  // Only replace tool scope when the editor sent it, so older clients keep it.
  if (input.extra.tools !== undefined) delete base.tools
  if (input.extra.mcpServers !== undefined) delete base.mcpServers
  if (input.type === "agent") {
    if (input.extra.model !== undefined) delete base.model
    if (input.extra.provider !== undefined) delete base.provider
    // A task kind owns its provider, so a stale provider must not stay beside it.
    if (typeof extra.model === "string" && extra.model.startsWith("task:")) delete base.provider
  } else {
    delete base.model
    delete base.provider
  }

  switch (input.type) {
    case "rule":
      // Rules conventionally omit `name`; keep description first.
      return { description: input.description, ...extra, ...base }
    case "agent":
    case "command":
    case "skill":
    default:
      return { name: input.name, description: input.description, ...extra, ...base }
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

export function serializeArtifact(
  input: ArtifactInput,
  existingFrontmatter?: Record<string, unknown>
): SerializedArtifact {
  const data = frontmatterFor(input, existingFrontmatter)
  const body = input.body.trim()
  const content = matter.stringify(body ? `\n${body}\n` : "\n", data)
  return {
    relPath: artifactRelPath(input.platform, input.type, input.name),
    deletePath: artifactDeletePath(input.platform, input.type, input.name),
    content,
  }
}

/** An unsaved editor draft as an in-memory artifact (same frontmatter as on save). */
export function draftToArtifact(input: ArtifactInput): Artifact {
  return {
    name: input.name,
    type: input.type,
    platform: input.platform,
    description: input.description,
    frontmatter: frontmatterFor(input),
    body: input.body.trim(),
    relativePath: artifactRelPath(input.platform, input.type, input.name),
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
