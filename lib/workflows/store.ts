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

import { isWorkflowRun, workflowSchema, type Workflow, type WorkflowRun } from "./schema"

/**
 * Workflow definitions are shareable (`.black-agents/workflows/`); run files
 * are local history (`.black-agents/runs/`, git-ignored).
 */

export const WORKFLOWS_DIR = ".black-agents/workflows"
export const RUNS_DIR = ".black-agents/runs"
export const MAX_KEPT_RUNS = 200
const WORKFLOW_EXT = ".workflow.json"
const GITIGNORE = ".black-agents/.gitignore"
const GITIGNORE_LINES = ["runs/", "brain/inbox/"]

export class WorkflowNotFoundError extends Error {}

function workflowPath(root: string, name: string): string {
  return resolveInWorkspace(root, `${WORKFLOWS_DIR}/${name}${WORKFLOW_EXT}`)
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

export async function listWorkflows(root: string): Promise<Workflow[]> {
  const dir = resolveInWorkspace(root, WORKFLOWS_DIR)
  const out: Workflow[] = []
  for (const entry of await listDir(dir)) {
    if (entry.isDirectory || !entry.name.endsWith(WORKFLOW_EXT)) continue
    const wf = await readWorkflow(root, entry.name.slice(0, -WORKFLOW_EXT.length))
    if (wf) out.push(wf)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readWorkflow(root: string, name: string): Promise<Workflow | null> {
  const abs = workflowPath(root, name)
  if (!(await pathExists(abs))) return null
  try {
    const parsed = workflowSchema.safeParse(JSON.parse(await readText(abs)) as unknown)
    return parsed.success && parsed.data.name === name ? parsed.data : null
  } catch {
    return null
  }
}

export async function saveWorkflow(root: string, workflow: Workflow): Promise<void> {
  await writeText(workflowPath(root, workflow.name), `${JSON.stringify(workflow, null, 2)}\n`)
}

export async function deleteWorkflow(root: string, name: string): Promise<boolean> {
  const abs = workflowPath(root, name)
  if (!(await pathExists(abs))) return false
  await removePath(abs)
  return true
}

export async function workflowExists(root: string, name: string): Promise<boolean> {
  return pathExists(workflowPath(root, name))
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

/** Newest first. Optionally only one workflow's runs. */
export async function listRuns(root: string, workflow?: string): Promise<WorkflowRun[]> {
  const dir = resolveInWorkspace(root, RUNS_DIR)
  const runs: WorkflowRun[] = []
  for (const entry of await listDir(dir)) {
    if (entry.isDirectory || !entry.name.endsWith(".json") || entry.name.startsWith(".")) continue
    const run = await readRun(root, entry.name.slice(0, -5))
    if (run && (!workflow || run.workflow === workflow)) runs.push(run)
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Drop the oldest finished runs beyond the history cap. */
export async function pruneRuns(root: string, keep = MAX_KEPT_RUNS): Promise<number> {
  const runs = await listRuns(root)
  const old = runs.slice(keep).filter((r) => r.finishedAt)
  for (const run of old) await removePath(runPath(root, run.id))
  return old.length
}
