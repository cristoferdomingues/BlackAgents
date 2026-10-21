import { promises as fs } from "node:fs"
import path from "node:path"

import {
  listDir,
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"
import { inheritsScopeToken, projectDirRelPath } from "@/lib/artifacts/projects"

import { deleteAuditEvents } from "./audit"
import { isWorkflowRun, workflowSchema, type Workflow, type WorkflowRun } from "./schema"

/**
 * Workflow definitions are shareable (`.black-agents/workflows/`); run files
 * are local history (`.black-agents/runs/`, git-ignored).
 *
 * A project scope may own workflows at
 * `.black-agents/projects/<id>/workflows/`. Resolution is scope-first: the
 * project file wins on name, and workspace workflows are only visible when the
 * `workflows` token is whitelisted in `project.json` (fail closed).
 */

export const WORKFLOWS_DIR = ".black-agents/workflows"
export const RUNS_DIR = ".black-agents/runs"
export const MAX_KEPT_RUNS = 200
const WORKFLOW_EXT = ".workflow.json"
const GITIGNORE = ".black-agents/.gitignore"
const GITIGNORE_LINES = ["runs/", "brain/inbox/", "meetings/", "k0ding/"]

export class WorkflowNotFoundError extends Error {}

/** Workflows folder for a scope (project folder id, or the workspace). */
export function workflowsDirRelPath(scope?: string): string {
  return scope ? `${projectDirRelPath(scope)}/workflows` : WORKFLOWS_DIR
}

function workflowPath(root: string, name: string, scope?: string): string {
  return resolveInWorkspace(root, `${workflowsDirRelPath(scope)}/${name}${WORKFLOW_EXT}`)
}

function runPath(root: string, id: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new WorkflowNotFoundError("Invalid run id")
  return resolveInWorkspace(root, `${RUNS_DIR}/${id}.json`)
}

/** Keep local run history and brain inbox out of git. */
export async function ensureLocalStateIgnored(root: string): Promise<void> {
  const abs = resolveInWorkspace(root, GITIGNORE)
  const current = (await pathExists(abs)) ? await readText(abs) : ""
  const missing = GITIGNORE_LINES.filter((line) => !current.split("\n").includes(line))
  if (missing.length === 0) return
  const prefix = current && !current.endsWith("\n") ? `${current}\n` : current
  await writeText(abs, `${prefix}${missing.join("\n")}\n`)
}

/** Read every workflow under a workflows folder, sorted by name. */
async function listWorkflowFiles(root: string, dirRelPath: string): Promise<Workflow[]> {
  const out: Workflow[] = []
  for (const entry of await listDir(resolveInWorkspace(root, dirRelPath))) {
    if (entry.isDirectory || !entry.name.endsWith(WORKFLOW_EXT)) continue
    const name = entry.name.slice(0, -WORKFLOW_EXT.length)
    const abs = resolveInWorkspace(root, `${dirRelPath}/${name}${WORKFLOW_EXT}`)
    const wf = await readWorkflowFile(abs, name)
    if (wf) out.push(wf)
  }
  return out
}

async function readWorkflowFile(abs: string, name: string): Promise<Workflow | null> {
  if (!(await pathExists(abs))) return null
  try {
    const parsed = workflowSchema.safeParse(JSON.parse(await readText(abs)) as unknown)
    return parsed.success && parsed.data.name === name ? parsed.data : null
  } catch {
    return null
  }
}

/** Workflows visible in a scope. Project files first; workspace files only when whitelisted. */
export async function listWorkflows(root: string, scope?: string): Promise<Workflow[]> {
  if (!scope) {
    return (await listWorkflowFiles(root, WORKFLOWS_DIR)).sort((a, b) => a.name.localeCompare(b.name))
  }

  // A project's own files are always visible (same rule as project artifacts);
  // the token only gates the *parent's* folder. Fail closed when it is absent.
  const byName = new Map<string, Workflow>()
  for (const wf of await listWorkflowFiles(root, workflowsDirRelPath(scope))) {
    byName.set(wf.name, wf)
  }
  if (!(await inheritsScopeToken(root, scope, "workflows"))) {
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  for (const wf of await listWorkflowFiles(root, WORKFLOWS_DIR)) {
    if (!byName.has(wf.name)) byName.set(wf.name, wf)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function readWorkflow(
  root: string,
  name: string,
  scope?: string
): Promise<Workflow | null> {
  if (!scope) return readWorkflowFile(workflowPath(root, name), name)

  const local = await readWorkflowFile(workflowPath(root, name, scope), name)
  if (local) return local
  if (!(await inheritsScopeToken(root, scope, "workflows"))) return null
  return readWorkflowFile(workflowPath(root, name), name)
}

/** Save a workflow into a scope: the project folder when scoped, else the workspace. */
export async function saveWorkflow(
  root: string,
  workflow: Workflow,
  scope?: string
): Promise<void> {
  await writeText(
    workflowPath(root, workflow.name, scope),
    `${JSON.stringify(workflow, null, 2)}\n`
  )
}

/**
 * Delete a workflow from a scope. A project scope only ever removes its own
 * files — inherited workspace workflows are read-only from a child scope.
 */
export async function deleteWorkflow(
  root: string,
  name: string,
  scope?: string
): Promise<boolean> {
  const abs = workflowPath(root, name, scope)
  if (!(await pathExists(abs))) return false
  await removePath(abs)
  return true
}

export async function workflowExists(
  root: string,
  name: string,
  scope?: string
): Promise<boolean> {
  if (await pathExists(workflowPath(root, name, scope))) return true
  if (!scope) return false
  if (!(await inheritsScopeToken(root, scope, "workflows"))) return false
  return pathExists(workflowPath(root, name))
}

/** True when this scope owns the file itself, not just an inherited workspace copy. */
export async function workflowIsLocal(root: string, name: string, scope?: string): Promise<boolean> {
  if (!scope) return true
  return pathExists(workflowPath(root, name, scope))
}

export async function saveRun(run: WorkflowRun): Promise<void> {
  await ensureLocalStateIgnored(run.workspaceRoot)
  const abs = runPath(run.workspaceRoot, run.id)
  const tmp = `${abs}.tmp`
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(run, null, 2), "utf8")
  await fs.rename(tmp, abs)
}

export async function readRun(root: string, id: string): Promise<WorkflowRun | null> {
  try {
    const abs = runPath(root, id)
    if (!(await pathExists(abs))) return null
    const value: unknown = JSON.parse(await readText(abs))
    return isWorkflowRun(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Newest first. Optionally only one workflow's runs.
 *
 * `scope` filters by project: omit it (`undefined`) to see every run regardless
 * of scope, pass `null` for the workspace's own runs, or a project id for that
 * project's runs. This tells apart "don't care" from "the workspace scope",
 * since a project may own a workflow with the same name.
 */
export async function listRuns(
  root: string,
  workflow?: string,
  scope?: string | null
): Promise<WorkflowRun[]> {
  const dir = resolveInWorkspace(root, RUNS_DIR)
  const runs: WorkflowRun[] = []
  for (const entry of await listDir(dir)) {
    if (entry.isDirectory || !entry.name.endsWith(".json") || entry.name.startsWith(".")) continue
    const run = await readRun(root, entry.name.slice(0, -5))
    if (!run) continue
    if (workflow && run.workflow !== workflow) continue
    if (scope !== undefined && (run.projectScope ?? null) !== scope) continue
    runs.push(run)
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Drop the oldest finished runs beyond the history cap. */
export async function pruneRuns(root: string, keep = MAX_KEPT_RUNS): Promise<number> {
  const runs = await listRuns(root)
  const old = runs.slice(keep).filter((r) => r.finishedAt)
  for (const run of old) {
    await removePath(runPath(root, run.id))
    await deleteAuditEvents(root, run.id).catch(() => undefined)
  }
  return old.length
}
