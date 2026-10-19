import matter from "gray-matter"

import { sourceDeletePath, sourceRelPath } from "./source"
import { normalizeExtra, type ArtifactInput } from "./schemas"
import type { Artifact } from "./types"

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
  /** Path (relative to workspace root) of the primary file in the source folder. */
  relPath: string
  /** Path to remove on delete (the skill directory for nested types). */
  deletePath: string
  /** Full file content including the frontmatter block. */
  content: string
}

export function serializeArtifact(
  input: ArtifactInput,
  existingFrontmatter?: Record<string, unknown>,
  scope?: string
): SerializedArtifact {
  const data = frontmatterFor(input, existingFrontmatter)
  const body = input.body.trim()
  const content = matter.stringify(body ? `\n${body}\n` : "\n", data)
  return {
    relPath: sourceRelPath(input.type, input.name, scope),
    deletePath: sourceDeletePath(input.type, input.name, scope),
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
    relativePath: sourceRelPath(input.type, input.name),
    managed: true,
  }
}
