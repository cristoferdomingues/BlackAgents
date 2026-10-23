/**
 * Platform-agnostic domain model for AI agent artifacts.
 *
 * The internal model is intentionally decoupled from any single tool's folder
 * layout so that multi-platform export (.cursor / .claude / .windsurf / …) can
 * be implemented as a thin adapter over these types.
 */

export type ArtifactType = "agent" | "command" | "rule" | "skill"

export type Platform = "cursor" | "claude" | "windsurf" | "antigravity" | "opencode"

export interface ArtifactFrontmatter {
  name?: string
  description?: string
  /** Agents: marks parallelizable review workers. */
  parallel?: boolean
  /** Rules: auto-apply guardrail on every request. */
  alwaysApply?: boolean
  /** Rules: activate when matching files are edited. */
  globs?: string[]
  [key: string]: unknown
}

export interface Artifact {
  /** kebab-case identifier without extension (for skills, the directory name). */
  name: string
  type: ArtifactType
  platform: Platform
  description: string
  frontmatter: ArtifactFrontmatter
  /** Markdown body (everything after the frontmatter block). */
  body: string
  /** Path relative to the workspace root, using POSIX separators. */
  relativePath: string
  /** Skills only: supporting files bundled in the skill directory. */
  supportingFiles?: string[]
  /** True when this artifact is embedded in BlackAgents rather than stored in the workspace. */
  builtin?: boolean
  /**
   * True when the artifact lives in `.black-agents/artifacts/` (the source).
   * False or missing: it was only found in an IDE folder (`platform`).
   */
  managed?: boolean
  /**
   * Project scope this artifact came from: the folder id under
   * `.black-agents/projects/`. Absent = workspace (global) scope.
   * Injected by the scanner from the scan root, never authored in frontmatter,
   * and never exported into IDE folders.
   */
  scope?: { project: string }
}

/** A directed cross-reference detected between two artifacts. */
export interface ArtifactReference {
  from: ArtifactType
  fromName: string
  /** Project scope of the referencing artifact; absent = workspace scope. */
  fromScope?: string
  to: ArtifactType
  toName: string
  /** Project scope the target resolved in; absent = workspace scope. */
  toScope?: string
  /** How the link was detected (used for debugging / display). */
  kind: "command-agent" | "agent-rule" | "agent-skill" | "rule-rule" | "rule-skill"
}

export type GraphNodeType = ArtifactType | "concept"

export interface GraphNode {
  id: string
  name: string
  type: GraphNodeType
  /** Project scope of the artifact; absent = workspace scope. */
  scope?: string
  /** Number of connected edges, used to size the node. */
  degree: number
}

export interface GraphLink {
  source: string
  target: string
  kind: ArtifactReference["kind"] | "concept-concept" | "concept-artifact" | "artifact-concept"
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

/** A workspace is a project folder on disk that holds artifact files. */
export interface Workspace {
  /** Absolute path to the project root. */
  path: string
  /** Display name (defaults to the folder basename). */
  name: string
}

export function artifactId(type: ArtifactType, name: string): string {
  return `${type}:${name}`
}
