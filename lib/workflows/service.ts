import { scanWorkspace } from "@/lib/artifacts/parser"

import { summarizeRun, workflowSchema, type RunSummary, type Workflow } from "./schema"
import { getRunner } from "./runner"
import { listRuns, listWorkflows } from "./store"

export interface WorkflowListItem {
  workflow: Workflow
  lastRun: RunSummary | null
  active: boolean
}

export async function listWorkflowItems(root: string): Promise<WorkflowListItem[]> {
  const [workflows, runs] = await Promise.all([listWorkflows(root), listRuns(root)])
  const runner = getRunner()
  return workflows.map((workflow) => {
    const last = runs.find((r) => r.workflow === workflow.name)
    return {
      workflow,
      lastRun: last ? summarizeRun(last) : null,
      active: runner.isActive(root, workflow.name),
    }
  })
}

export type ParsedWorkflow = { ok: true; workflow: Workflow } | { ok: false; message: string }

/** Validate a workflow body and check that every step's agent exists. */
export async function parseWorkflowBody(root: string, body: unknown): Promise<ParsedWorkflow> {
  const parsed = workflowSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : ""
    return { ok: false, message: `${where}${issue?.message ?? "Invalid workflow"}` }
  }
  const agents = new Set(
    (await scanWorkspace(root)).filter((a) => a.type === "agent").map((a) => a.name)
  )
  const missing = parsed.data.steps.find((s) => !agents.has(s.agent))
  if (missing) return { ok: false, message: `Step "${missing.id}": agent "${missing.agent}" was not found` }
  return { ok: true, workflow: parsed.data }
}
