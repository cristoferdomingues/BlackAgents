import type { ArtifactType } from "./types"
import type { TypeLayout } from "./layout"
import { projectIdSchema } from "./schemas"

/**
 * BlackAgents keeps its own copy of every artifact in `.black-agents/artifacts/`.
 * That copy is the source of truth; IDE folders (`.cursor/`, `.claude/`, …) are
 * export targets written from it on every save.
 *
 * A *project scope* is a one-level sub-scope at `.black-agents/projects/<id>/`
 * with its own copy of the same layout. `projectId` is always a single
 * kebab-case folder segment — never a path — so nesting beyond one level is
 * structurally impossible here.
 */

export const SOURCE_ROOT = ".black-agents/artifacts"

/** One-level sub-scopes live directly under this folder. */
export const PROJECTS_ROOT = ".black-agents/projects"

/** Workspace (global) scope id is `undefined`; a project scope is a kebab folder id. */
export type ScopeId = string | undefined

/** Source root for a scope: the project tree, or the workspace tree. */
export function sourceRoot(projectId?: string): string {
  if (projectId === undefined) return SOURCE_ROOT
  // Fail closed: a scope id is a single kebab-case folder segment, never a
  // path — "../.." or "a/b" must throw, not silently resolve elsewhere.
  const parsed = projectIdSchema.safeParse(projectId)
  if (!parsed.success) {
    throw new Error(`Invalid project id "${projectId}"`)
  }
  return `${PROJECTS_ROOT}/${parsed.data}/artifacts`
}

/** Shared per-type layout, rebased under the scope's source root. */
export function sourceLayout(projectId?: string): Record<ArtifactType, TypeLayout> {
  const root = sourceRoot(projectId)
  return {
    agent: { dir: `${root}/agents`, ext: ".md", nested: false },
    command: { dir: `${root}/commands`, ext: ".md", nested: false },
    rule: { dir: `${root}/rules`, ext: ".md", nested: false },
    skill: { dir: `${root}/skills`, ext: ".md", nested: true, entryFile: "SKILL.md" },
  }
}

/** Back-compat: the workspace-global layout (existing consumers keep working). */
export const SOURCE_LAYOUT: Record<ArtifactType, TypeLayout> = sourceLayout()

/** Relative path of the artifact's primary file in the scope's source folder. */
export function sourceRelPath(type: ArtifactType, name: string, projectId?: string): string {
  const layout = sourceLayout(projectId)[type]
  return layout.nested
    ? `${layout.dir}/${name}/${layout.entryFile}`
    : `${layout.dir}/${name}${layout.ext}`
}

/** Path removed on delete: the folder for skills, the file otherwise. */
export function sourceDeletePath(type: ArtifactType, name: string, projectId?: string): string {
  const layout = sourceLayout(projectId)[type]
  return layout.nested ? `${layout.dir}/${name}` : `${layout.dir}/${name}${layout.ext}`
}

export function isSourcePath(relPath: string, projectId?: string): boolean {
  const root = sourceRoot(projectId)
  return relPath === root || relPath.startsWith(`${root}/`)
}
