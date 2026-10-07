import { z } from "zod"

import { nameSchema } from "../artifacts/schemas"
import { builtinToolNameSchema } from "../runtime/tool-names"
import type { ApprovalRequest, ToolExecutionTrace } from "../runtime/types"

/**
 * Workflows: a production line of agents. Each step runs one workspace agent;
 * its output is handed to the next step. Definitions live in the workspace
 * (`.black-agents/workflows/<name>.workflow.json`) so they can be committed.
 * Isomorphic — the builder UI validates with the same schema.
 */

export const MAX_WORKFLOW_STEPS = 10
export const MAX_STEP_TURNS = 8
export const MAX_GATE_RETRIES = 2

const stepIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Step ids use kebab-case")

export const workflowStepSchema = z.object({
  id: stepIdSchema,
  agent: nameSchema,
  instructions: z.string().max(4_000).default(""),
  /** What the step receives: the previous output, only the task, or every earlier output. */
  input: z.enum(["previous", "task", "all"]).default("previous"),
  /** Overrides the agent's own `tools` frontmatter when set. */
  tools: z.array(builtinToolNameSchema).optional(),
  mcpServers: z.array(z.string().trim().min(1)).optional(),
  /** Auto-approve file writes in this step (commands still ask). */
  allowWrites: z.boolean().default(false),
  maxTurns: z.number().int().min(1).max(MAX_STEP_TURNS).default(6),
  /** Ask Jev after this step: continue, retry the step, or stop the line. */
  gate: z.boolean().default(false),
})
export type WorkflowStep = z.infer<typeof workflowStepSchema>

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("interval"), everyMinutes: z.number().int().min(5).max(1_440) }),
  z.object({
    type: z.literal("daily"),
    at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)"),
  }),
])
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>

export const workflowSchema = z
  .object({
    name: nameSchema,
    description: z.string().trim().max(300).default(""),
    /** Default task text, used by scheduled runs and as the run form default. */
    task: z.string().max(4_000).default(""),
    provider: z.enum(["openai", "anthropic", "custom"]).optional(),
    model: z.string().trim().max(200).optional(),
    trigger: workflowTriggerSchema.default({ type: "manual" }),
    steps: z.array(workflowStepSchema).min(1, "Add at least one step").max(MAX_WORKFLOW_STEPS),
    limits: z
      .object({
        stepTimeoutMinutes: z.number().int().min(1).max(30).default(10),
        runTimeoutMinutes: z.number().int().min(1).max(180).default(60),
        maxRetries: z.number().int().min(0).max(MAX_GATE_RETRIES).default(1),
      })
      .default({}),
    /** After each run, let each agent reflect and propose learnings (Second Brain). */
    selfAssess: z.boolean().default(false),
  })
  .superRefine((wf, ctx) => {
    const ids = new Set<string>()
    wf.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: "custom", path: ["steps", index, "id"], message: `Duplicate step id "${step.id}"` })
      }
      ids.add(step.id)
    })
  })
export type Workflow = z.infer<typeof workflowSchema>
export type WorkflowInput = z.input<typeof workflowSchema>

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]
export const TERMINAL_STATUSES: readonly RunStatus[] = ["succeeded", "failed", "cancelled"]

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "skipped"

export interface StepGateResult {
  decision: "continue" | "retry" | "stop"
  by: "jev" | "default"
  confidence?: number
}

export interface StepRun {
  id: string
  agent: string
  status: StepStatus
  attempts: number
  output?: string
  error?: string
  toolExecutions: ToolExecutionTrace[]
  filesChanged: string[]
  gate?: StepGateResult
  startedAt?: string
  finishedAt?: string
}

export interface WorkflowRun {
  id: string
  workflow: string
  workspaceRoot: string
  status: RunStatus
  trigger: "manual" | "schedule"
  task: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
  /** Short end-of-run summary (last output, or why it stopped). */
  report?: string
  steps: StepRun[]
  pendingApproval?: ApprovalRequest | null
}

export interface RunSummary {
  id: string
  workflow: string
  status: RunStatus
  trigger: WorkflowRun["trigger"]
  createdAt: string
  finishedAt?: string
}

export function summarizeRun(run: WorkflowRun): RunSummary {
  return {
    id: run.id,
    workflow: run.workflow,
    status: run.status,
    trigger: run.trigger,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  }
}

const runFileSchema = z
  .object({
    id: z.string(),
    workflow: z.string(),
    workspaceRoot: z.string(),
    status: z.enum(RUN_STATUSES),
    createdAt: z.string(),
    steps: z.array(z.object({ id: z.string(), agent: z.string(), status: z.string() }).passthrough()),
  })
  .passthrough()

/** Run files and SSE snapshots are app-written, but still checked before use. */
export function isWorkflowRun(value: unknown): value is WorkflowRun {
  return runFileSchema.safeParse(value).success
}
