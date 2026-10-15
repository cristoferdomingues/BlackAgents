import matter from "gray-matter"

import { artifactRelPath } from "../artifacts/layout"
import type { Artifact, ArtifactFrontmatter, Platform } from "../artifacts/types"
import { isAgentModelAlias, parseModelRef } from "../llm/model-ref"

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
 * Cursor and Claude understand `model`. Write a real id, or a tool alias
 * (`sonnet`, `fast`, …) unchanged. Never write `provider` or `task:` refs.
 */
function exportedAgentModel(type: Artifact["type"], frontmatter: ArtifactFrontmatter): string | undefined {
  if (type !== "agent" || typeof frontmatter.model !== "string") return undefined
  const model = frontmatter.model.trim()
  if (!model || model === "inherit") return undefined
  if (isAgentModelAlias(model)) return model
  try {
    const ref = parseModelRef(model, undefined)
    return ref.kind === "id" ? ref.model : undefined
  } catch {
    return undefined
  }
}

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
      const cursorModel = exportedAgentModel(type, frontmatter)
      if (cursorModel) fm.model = cursorModel
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
      const claudeModel = exportedAgentModel(type, frontmatter)
      if (claudeModel) fm.model = claudeModel
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

    case "antigravity": {
      if (type !== "rule") fm.name = name
      if (description) fm.description = description
      if (type === "agent" && frontmatter.parallel) fm.parallel = true
      if (type === "rule") {
        if (frontmatter.alwaysApply) fm.alwaysApply = true
        if (globs.length > 0) fm.globs = globs
      }
      return fm
    }

    default:
      return fm
  }
}

/** Keys the mapping above owns or that only BlackAgents understands. */
const MANAGED_KEYS = new Set([
  "name",
  "description",
  "model",
  "provider",
  "parallel",
  "alwaysApply",
  "globs",
  "trigger",
  "tools",
  "mcpServers",
])

/** Mapped keys plus the keys BlackAgents does not manage (e.g. Cursor's `readonly`), unchanged. */
export function exportedFrontmatter(platform: Platform, artifact: Artifact): Record<string, unknown> {
  const data = frontmatterFor(platform, artifact)
  for (const [key, value] of Object.entries(artifact.frontmatter)) {
    if (!MANAGED_KEYS.has(key) && value !== undefined) data[key] = value
  }
  return data
}

export function artifactToFile(
  artifact: Artifact,
  targetPlatform: Platform
): ExportFile {
  const data = exportedFrontmatter(targetPlatform, artifact)
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
