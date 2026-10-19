import type { Artifact } from "./types"
import type { ScopeToken } from "./schemas"

/** Plain-language help for project scopes (safe for the browser). */

export const PROJECTS_INTRO =
  "A project is a small space inside this workspace. It has its own agents, commands, rules, and skills. It sees workspace items only when you allow them."

export const PROJECTS_WHERE = "Saved in .black-agents/projects/<id>/project.json."

export const WORKSPACE_MODE_LABEL = "Whole workspace"

export const WORKSPACE_MODE_HELP = "Show everything in the workspace. No project is active."

export const INHERITS_HELP =
  "Allowed items come from the workspace. Anything you do not allow stays hidden from the project. The Brain and secrets are never shared."

export const SCOPE_TOKENS: ReadonlyArray<{ token: ScopeToken; label: string; help: string }> = [
  { token: "agents", label: "Agents", help: "Workspace agents show in this project." },
  { token: "commands", label: "Commands", help: "Workspace commands show in this project." },
  { token: "rules", label: "Rules", help: "Workspace rules show in this project." },
  { token: "skills", label: "Skills", help: "Workspace skills show in this project." },
  { token: "workflows", label: "Workflows", help: "Workspace workflows show in this project." },
  { token: "mcp", label: "MCP servers", help: "Workspace MCP servers are added under the project's own servers." },
  { token: "knowledge", label: "Knowledge", help: "Workspace knowledge notes can be read. They stay read-only." },
]

export const ACTION = {
  create: "Create adds the project folder and its project.json. Nothing else changes.",
  save: "Save updates what this project may see from the workspace.",
  remove: "Delete removes the project folder and every file inside it.",
  activate: "Open makes this project active. Lists and new items then use this project.",
} as const

export const EMPTY = {
  title: "No projects yet",
  text: "Create one below. Its files go in .black-agents/projects/<id>/. Example: a workspace MyHome with a project MyHealthCare.",
} as const

export const INVALID_TITLE = "Projects that did not load"

export const INVALID_HELP =
  "These folders were skipped to keep the workspace safe. Fix the project.json file, then refresh."

export const INHERITED_READ_ONLY =
  "This item comes from the workspace. It is read-only in this project. Create an item with the same name in the project to change it here."

export type ArtifactOrigin = "project" | "inherited" | "workspace"

/** Where an artifact comes from, seen from the active project (if any). */
export function artifactOrigin(artifact: Pick<Artifact, "scope">, activeProject: string | null): ArtifactOrigin {
  if (!activeProject) return "workspace"
  return artifact.scope?.project === activeProject ? "project" : "inherited"
}

export const ORIGIN_BADGE: Record<Exclude<ArtifactOrigin, "workspace">, { label: string; help: string }> = {
  project: { label: "Project", help: "Saved in this project." },
  inherited: { label: "Inherited", help: "From the workspace. Read-only here." },
}

/** Add `?scope=<project>` to an artifact API URL when a project is active. */
export function withScope(url: string, project: string | null | undefined): string {
  if (!project) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}scope=${encodeURIComponent(project)}`
}

/** Short summary of a whitelist for list rows. */
export function inheritsSummary(inherits: readonly ScopeToken[]): string {
  if (inherits.length === 0) return "Sees nothing from the workspace"
  const labels = SCOPE_TOKENS.filter((t) => inherits.includes(t.token)).map((t) => t.label.toLowerCase())
  return `Sees workspace ${labels.join(", ")}`
}

/** Turn a project name into a valid folder id while typing. */
export function suggestProjectId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}
