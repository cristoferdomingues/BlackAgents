import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { scanWorkspace } from "@/lib/artifacts/parser"
import { loadBrainContext } from "@/lib/brain/context"
import { selfAssessRun } from "@/lib/brain/learn"
import { readConfig } from "@/lib/config"
import { evaluateWorkflowPreflight } from "@/lib/decision/classify-workflow"
import { loadDecisionClient } from "@/lib/decision/client"
import { resolveInWorkspace } from "@/lib/fs-service"
import { buildToolset } from "@/lib/runtime/tools"

import { filesChangedSince } from "./changes"
import { executeRun, newRun, type ExecutorDeps } from "./executor"
import { resolveRunLlm } from "./llm"
import { isTerminal, type Workflow, type WorkflowRun, type WorkflowTrigger } from "./schema"
import { listRuns, listWorkflows, pruneRuns, readWorkflow, RUNS_DIR, saveRun } from "./store"

export const SCHEDULER_TICK_MS = 60_000
const SCHEDULE_STATE_FILE = `${RUNS_DIR}/.schedule-state.json`

export type RunListener = (run: WorkflowRun) => void
export type RunFinishedHook = (run: WorkflowRun, workflow: Workflow) => Promise<void>

const scheduleStateSchema = z.record(
  z.object({
    lastCheckAt: z.string().optional(),
    lastSkip: z.object({ at: z.string(), reason: z.string() }).optional(),
  })
)
type ScheduleState = z.infer<typeof scheduleStateSchema>

/** Is a scheduled trigger due now, given when it was last checked? */
export function isDue(trigger: WorkflowTrigger, lastCheckAt: string | undefined, now: Date): boolean {
  if (trigger.type === "manual") return false
  const last = lastCheckAt ? Date.parse(lastCheckAt) : Number.NaN
  if (trigger.type === "interval") {
    return Number.isNaN(last) || now.getTime() - last >= trigger.everyMinutes * 60_000
  }
  const [h, m] = trigger.at.split(":").map(Number)
  const slot = new Date(now)
  slot.setHours(h, m, 0, 0)
  if (now < slot) return false
  return Number.isNaN(last) || last < slot.getTime()
}

async function readScheduleState(root: string): Promise<ScheduleState> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(resolveInWorkspace(root, SCHEDULE_STATE_FILE), "utf8"))
    const parsed = scheduleStateSchema.safeParse(raw)
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

async function writeScheduleState(root: string, state: ScheduleState): Promise<void> {
  const abs = resolveInWorkspace(root, SCHEDULE_STATE_FILE)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, JSON.stringify(state, null, 2), "utf8")
}

interface QueuedRun {
  run: WorkflowRun
  workflow: Workflow
}

/**
 * In-process workflow runner: one queue per workflow (one run at a time),
 * a scheduler tick for interval/daily triggers, and live run updates for SSE.
 * Lives on `globalThis` so dev hot reloads keep a single instance.
 */
export class WorkflowRunner {
  private started = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly controllers = new Map<string, AbortController>()
  private readonly queues = new Map<string, QueuedRun[]>()
  private readonly busy = new Set<string>()
  private readonly listeners = new Set<RunListener>()
  onFinished: RunFinishedHook | null = null

  constructor(private readonly deps: Omit<ExecutorDeps, "save" | "emit">) {}

  /** Idempotent: recover interrupted runs and start the scheduler. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const { currentPath } = await readConfig()
    if (currentPath) await this.recover(currentPath)
    this.timer = setInterval(() => void this.tick().catch(() => undefined), SCHEDULER_TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.started = false
  }

  /** Runs left unfinished by a previous process can never resume. */
  async recover(root: string): Promise<number> {
    let count = 0
    for (const run of await listRuns(root)) {
      if (isTerminal(run.status) || this.controllers.has(run.id) || this.isQueued(run.id)) continue
      run.status = "failed"
      run.error = "Interrupted: BlackAgents restarted before the run finished"
      run.finishedAt = new Date().toISOString()
      run.pendingApproval = null
      await saveRun(run)
      count++
    }
    return count
  }

  subscribe(listener: RunListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async enqueue(params: {
    root: string
    workflow: Workflow
    trigger: WorkflowRun["trigger"]
    task?: string
  }): Promise<WorkflowRun> {
    const run = newRun({
      id: randomUUID(),
      workflow: params.workflow,
      workspaceRoot: params.root,
      trigger: params.trigger,
      task: params.task?.trim() || params.workflow.task,
    })
    await saveRun(run)
    this.emit(run)
    const key = this.key(params.root, params.workflow.name)
    const queue = this.queues.get(key) ?? []
    queue.push({ run, workflow: params.workflow })
    this.queues.set(key, queue)
    void this.drain(key)
    return run
  }

  /** Cancel a queued or running run. False when it is not active here. */
  async cancel(runId: string): Promise<boolean> {
    const controller = this.controllers.get(runId)
    if (controller) {
      controller.abort()
      return true
    }
    for (const queue of this.queues.values()) {
      const index = queue.findIndex((q) => q.run.id === runId)
      if (index === -1) continue
      const [{ run }] = queue.splice(index, 1)
      run.status = "cancelled"
      run.error = "Cancelled by the user"
      run.finishedAt = new Date().toISOString()
      run.steps.forEach((s) => (s.status = "skipped"))
      await saveRun(run)
      this.emit(run)
      return true
    }
    return false
  }

  isActive(root: string, workflow: string): boolean {
    const key = this.key(root, workflow)
    return this.busy.has(key) || (this.queues.get(key)?.length ?? 0) > 0
  }

  /** Start due scheduled workflows in the active workspace. */
  async tick(now = new Date()): Promise<string[]> {
    const { currentPath: root } = await readConfig()
    if (!root) return []
    const state = await readScheduleState(root)
    const started: string[] = []
    let changed = false
    for (const workflow of await listWorkflows(root)) {
      const entry = state[workflow.name] ?? {}
      if (!isDue(workflow.trigger, entry.lastCheckAt, now)) continue
      if (this.isActive(root, workflow.name)) continue
      entry.lastCheckAt = now.toISOString()
      state[workflow.name] = entry
      changed = true

      const skip = await this.preflight(root, workflow)
      if (skip) {
        entry.lastSkip = { at: now.toISOString(), reason: skip }
        continue
      }
      await this.enqueue({ root, workflow, trigger: "schedule" })
      started.push(workflow.name)
    }
    if (changed) await writeScheduleState(root, state)
    return started
  }

  /** Returns a skip reason only when Jev is very sure nothing needs doing. */
  private async preflight(root: string, workflow: Workflow): Promise<string | null> {
    const resolved = await this.deps.decision()
    if (!resolved) return null
    const last = (await listRuns(root, workflow.name)).find((r) => r.status === "succeeded")
    const decision = await evaluateWorkflowPreflight({
      resolved,
      workflow: workflow.name,
      description: workflow.description,
      task: workflow.task,
      lastRun: last ? { status: last.status, finishedAt: last.finishedAt, report: last.report } : null,
      changedFiles: await filesChangedSince(root, last?.finishedAt),
    })
    return decision.kind === "skip"
      ? `Jev saw nothing new to do (confidence ${decision.confidence.toFixed(2)})`
      : null
  }

  private async drain(key: string): Promise<void> {
    if (this.busy.has(key)) return
    const next = this.queues.get(key)?.shift()
    if (!next) return
    this.busy.add(key)
    const controller = new AbortController()
    this.controllers.set(next.run.id, controller)
    try {
      const latest = (await readWorkflow(next.run.workspaceRoot, next.workflow.name)) ?? next.workflow
      const run = await executeRun(
        next.run,
        latest,
        {
          ...this.deps,
          save: saveRun,
          emit: (r) => this.emit(r),
        },
        controller.signal
      )
      await this.onFinished?.(run, latest).catch(() => undefined)
      await pruneRuns(run.workspaceRoot).catch(() => 0)
    } catch (err) {
      console.error("[workflows] run crashed:", err instanceof Error ? err.message : err)
    } finally {
      this.controllers.delete(next.run.id)
      this.busy.delete(key)
      void this.drain(key)
    }
  }

  private emit(run: WorkflowRun): void {
    const snapshot = structuredClone(run)
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // A broken listener must not stop the run.
      }
    }
  }

  private isQueued(runId: string): boolean {
    for (const queue of this.queues.values()) if (queue.some((q) => q.run.id === runId)) return true
    return false
  }

  private key(root: string, workflow: string): string {
    return `${root}::${workflow}`
  }
}

export const defaultExecutorDeps: Omit<ExecutorDeps, "save" | "emit"> = {
  artifacts: scanWorkspace,
  resolveLlm: (workflow) => resolveRunLlm({ provider: workflow.provider, model: workflow.model }),
  buildTools: buildToolset,
  decision: loadDecisionClient,
  brainContext: loadBrainContext,
}

const RUNNER_KEY = Symbol.for("black-agents.workflow-runner")
type RunnerGlobal = typeof globalThis & { [RUNNER_KEY]?: WorkflowRunner }

export function getRunner(): WorkflowRunner {
  const g = globalThis as RunnerGlobal
  if (!g[RUNNER_KEY]) {
    const runner = new WorkflowRunner(defaultExecutorDeps)
    runner.onFinished = async (run, workflow) => {
      await selfAssessRun(run, workflow)
    }
    g[RUNNER_KEY] = runner
  }
  return g[RUNNER_KEY]
}
