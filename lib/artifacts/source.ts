import type { ArtifactType } from "./types"
import type { TypeLayout } from "./layout"

/**
 * BlackAgents keeps its own copy of every artifact in `.black-agents/artifacts/`.
 * That copy is the source of truth; IDE folders (`.cursor/`, `.claude/`, …) are
 * export targets written from it on every save.
 */

export const SOURCE_ROOT = ".black-agents/artifacts"

export const SOURCE_LAYOUT: Record<ArtifactType, TypeLayout> = {
  agent: { dir: `${SOURCE_ROOT}/agents`, ext: ".md", nested: false },
  command: { dir: `${SOURCE_ROOT}/commands`, ext: ".md", nested: false },
  rule: { dir: `${SOURCE_ROOT}/rules`, ext: ".md", nested: false },
  skill: { dir: `${SOURCE_ROOT}/skills`, ext: ".md", nested: true, entryFile: "SKILL.md" },
}

/** Relative path of the artifact's primary file in the source folder. */
export function sourceRelPath(type: ArtifactType, name: string): string {
  const layout = SOURCE_LAYOUT[type]
  return layout.nested ? `${layout.dir}/${name}/${layout.entryFile}` : `${layout.dir}/${name}${layout.ext}`
}

/** Path removed on delete: the folder for skills, the file otherwise. */
export function sourceDeletePath(type: ArtifactType, name: string): string {
  const layout = SOURCE_LAYOUT[type]
  return layout.nested ? `${layout.dir}/${name}` : `${layout.dir}/${name}${layout.ext}`
}

export function isSourcePath(relPath: string): boolean {
  return relPath === SOURCE_ROOT || relPath.startsWith(`${SOURCE_ROOT}/`)
}
