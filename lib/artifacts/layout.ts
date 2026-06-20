import type { ArtifactType, Platform } from "./types"

/**
 * Where each artifact type lives on disk, per platform. The internal model is
 * platform-agnostic; this map is the single adapter between the model and a
 * concrete tool's folder convention.
 */

export interface TypeLayout {
  /** Directory (relative to workspace root) holding artifacts of this type. */
  dir: string
  /** File extension for flat artifacts (ignored when `nested`). */
  ext: string
  /** Skills are nested: `<dir>/<name>/<entryFile>` plus supporting files. */
  nested: boolean
  /** Entry filename for nested artifacts (e.g. SKILL.md). */
  entryFile?: string
}

export interface PlatformLayout {
  /** Root marker directory that signals the platform is present. */
  root: string
  label: string
  types: Record<ArtifactType, TypeLayout>
}

export const PLATFORM_LAYOUTS: Record<Platform, PlatformLayout> = {
  cursor: {
    root: ".cursor",
    label: "Cursor",
    types: {
      agent: { dir: ".cursor/agents", ext: ".md", nested: false },
      command: { dir: ".cursor/commands", ext: ".md", nested: false },
      rule: { dir: ".cursor/rules", ext: ".mdc", nested: false },
      skill: {
        dir: ".cursor/skills",
        ext: ".md",
        nested: true,
        entryFile: "SKILL.md",
      },
    },
  },
  claude: {
    root: ".claude",
    label: "Claude",
    types: {
      agent: { dir: ".claude/agents", ext: ".md", nested: false },
      command: { dir: ".claude/commands", ext: ".md", nested: false },
      rule: { dir: ".claude/rules", ext: ".md", nested: false },
      skill: {
        dir: ".claude/skills",
        ext: ".md",
        nested: true,
        entryFile: "SKILL.md",
      },
    },
  },
  windsurf: {
    root: ".windsurf",
    label: "Windsurf",
    types: {
      agent: { dir: ".windsurf/agents", ext: ".md", nested: false },
      command: { dir: ".windsurf/workflows", ext: ".md", nested: false },
      rule: { dir: ".windsurf/rules", ext: ".md", nested: false },
      skill: {
        dir: ".windsurf/skills",
        ext: ".md",
        nested: true,
        entryFile: "SKILL.md",
      },
    },
  },
}

/** Platforms scanned/managed in v1 (Cursor is primary). */
export const ACTIVE_PLATFORMS: Platform[] = ["cursor", "claude"]

export const DEFAULT_PLATFORM: Platform = "cursor"

export function typeLayout(platform: Platform, type: ArtifactType): TypeLayout {
  return PLATFORM_LAYOUTS[platform].types[type]
}

/** Relative path of the artifact's primary file. */
export function artifactRelPath(
  platform: Platform,
  type: ArtifactType,
  name: string
): string {
  const layout = typeLayout(platform, type)
  if (layout.nested) {
    return `${layout.dir}/${name}/${layout.entryFile}`
  }
  return `${layout.dir}/${name}${layout.ext}`
}

/** Relative directory that should be removed when deleting a nested artifact. */
export function artifactDeletePath(
  platform: Platform,
  type: ArtifactType,
  name: string
): string {
  const layout = typeLayout(platform, type)
  if (layout.nested) {
    return `${layout.dir}/${name}`
  }
  return `${layout.dir}/${name}${layout.ext}`
}
