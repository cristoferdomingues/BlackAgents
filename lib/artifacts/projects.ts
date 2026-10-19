import {
  listDir,
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"
import {
  projectIdSchema,
  projectManifestSchema,
  type ProjectManifest,
  type ScopeToken,
} from "./schemas"
import { sourceRoot } from "./source"

/**
 * Project scopes: one-level sub-scopes under `.black-agents/projects/<id>/`.
 * The `project.json` manifest holds the ONLY whitelist (`inherits`) through
 * which a project can see parent workspace services. Every loader that can be
 * scoped calls `inheritsScopeToken` and fails closed when it returns false:
 * missing manifest, bad id, bad JSON, unknown token or folder/id mismatch all
 * mean "inherits nothing" — never a partial fallback to the parent.
 */

export const PROJECTS_DIR = ".black-agents/projects"
export const PROJECT_MANIFEST_FILE = "project.json"

export interface ProjectScope {
  id: string
  name: string
  description?: string
  inherits: ScopeToken[]
  /** ISO timestamp from the manifest, when present. */
  createdAt?: string
  manifestRelPath: string
}

/** Discriminated result: callers can surface `error` while scans fail closed. */
export type LoadProjectResult =
  | { ok: true; project: ProjectScope }
  | { ok: false; error: string }

/** Thrown by the project write helpers; carries the HTTP status for routes. */
export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message)
  }
}

/** Validate a scope id and return its folder path. Throws on invalid ids. */
export function projectDirRelPath(id: string): string {
  const parsed = projectIdSchema.safeParse(id)
  if (!parsed.success) {
    throw new Error(`Invalid project id "${id}"`)
  }
  return `${PROJECTS_DIR}/${parsed.data}`
}

export function projectManifestRelPath(id: string): string {
  return `${projectDirRelPath(id)}/${PROJECT_MANIFEST_FILE}`
}

/**
 * Load and validate a scope manifest. Fail closed: any problem (bad id,
 * missing file, bad JSON, schema violation, `id` != folder name, traversal)
 * returns `{ ok: false }` — never a partially trusted whitelist.
 */
export async function loadProjectScope(
  root: string,
  id: string
): Promise<LoadProjectResult> {
  const idCheck = projectIdSchema.safeParse(id)
  if (!idCheck.success) return { ok: false, error: `Invalid project id "${id}"` }
  try {
    const rel = projectManifestRelPath(idCheck.data)
    const abs = resolveInWorkspace(root, rel)
    if (!(await pathExists(abs))) {
      return { ok: false, error: `Missing ${rel}` }
    }
    let raw: unknown
    try {
      raw = JSON.parse(await readText(abs)) as unknown
    } catch {
      return { ok: false, error: `Invalid JSON in ${rel}` }
    }
    const parsed = projectManifestSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid project.json" }
    }
    if (parsed.data.id !== idCheck.data) {
      return {
        ok: false,
        error: `project.json id "${parsed.data.id}" must equal the folder name "${idCheck.data}"`,
      }
    }
    const nested = `${projectDirRelPath(idCheck.data)}/projects`
    if (await pathExists(resolveInWorkspace(root, nested))) {
      return {
        ok: false,
        error: `Nested projects are not allowed: remove ${nested} (projects are one level only)`,
      }
    }
    return {
      ok: true,
      project: {
        id: parsed.data.id,
        name: parsed.data.name ?? parsed.data.id,
        description: parsed.data.description,
        inherits: parsed.data.inherits,
        createdAt: parsed.data.createdAt,
        manifestRelPath: rel,
      },
    }
  } catch (err) {
    // WorkspaceError (traversal) or I/O failure → fail closed.
    return { ok: false, error: err instanceof Error ? err.message : "Failed to read project.json" }
  }
}

/** Depth-1 only: `.black-agents/projects/<id>/`. Nested folders are never scopes. */
export async function listProjects(root: string): Promise<ProjectScope[]> {
  const dir = resolveInWorkspace(root, PROJECTS_DIR)
  if (!(await pathExists(dir))) return []
  const out: ProjectScope[] = []
  for (const entry of await listDir(dir)) {
    if (!entry.isDirectory) continue
    const loaded = await loadProjectScope(root, entry.name)
    if (loaded.ok) out.push(loaded.project)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** One broken project folder, kept visible so the UI can explain the rejection. */
export interface InvalidProject {
  folder: string
  error: string
}

/** Valid projects plus the fail-closed rejections (for API/UI surfacing). */
export async function listProjectsDetailed(root: string): Promise<{
  projects: ProjectScope[]
  invalid: InvalidProject[]
}> {
  const dir = resolveInWorkspace(root, PROJECTS_DIR)
  if (!(await pathExists(dir))) return { projects: [], invalid: [] }
  const projects: ProjectScope[] = []
  const invalid: InvalidProject[] = []
  for (const entry of await listDir(dir)) {
    if (!entry.isDirectory) continue
    const loaded = await loadProjectScope(root, entry.name)
    if (loaded.ok) {
      projects.push(loaded.project)
    } else {
      invalid.push({ folder: entry.name, error: loaded.error })
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name))
  return { projects, invalid }
}

/**
 * The single whitelist gate for every scoped loader: may an active project see
 * the workspace service behind `token`? Invalid or missing manifest → false.
 */
export async function inheritsScopeToken(
  root: string,
  scope: string | undefined,
  token: ScopeToken
): Promise<boolean> {
  if (!scope) return true // Workspace mode inherits the whole workspace (it owns it).
  const loaded = await loadProjectScope(root, scope)
  if (!loaded.ok) return false
  return loaded.project.inherits.includes(token)
}

/** Create a new project folder + manifest. Throws when it already exists. */
export async function createProject(
  root: string,
  input: ProjectManifest
): Promise<ProjectScope> {
  const manifestAbs = resolveInWorkspace(root, projectManifestRelPath(input.id))
  if (await pathExists(manifestAbs)) {
    throw new ProjectError(`A project with id "${input.id}" already exists`, 409)
  }
  // The folder may exist with other files; only reject an existing manifest.
  await writeText(manifestAbs, `${JSON.stringify(input, null, 2)}\n`)
  const loaded = await loadProjectScope(root, input.id)
  if (!loaded.ok) throw new ProjectError(loaded.error, 400)
  return loaded.project
}

/** Overwrite the manifest of an existing project (id stays the folder name). */
export async function saveProjectManifest(
  root: string,
  input: ProjectManifest
): Promise<ProjectScope> {
  const manifestAbs = resolveInWorkspace(root, projectManifestRelPath(input.id))
  if (!(await pathExists(manifestAbs))) {
    throw new ProjectError(`No project with id "${input.id}"`, 404)
  }
  await writeText(manifestAbs, `${JSON.stringify(input, null, 2)}\n`)
  const loaded = await loadProjectScope(root, input.id)
  if (!loaded.ok) throw new ProjectError(loaded.error, 400)
  return loaded.project
}

/** Delete the whole project folder. Returns false when it does not exist. */
export async function deleteProject(root: string, id: string): Promise<boolean> {
  const loaded = await loadProjectScope(root, id)
  if (!loaded.ok) return false
  await removePath(resolveInWorkspace(root, projectDirRelPath(id)))
  return true
}

export { sourceRoot }
