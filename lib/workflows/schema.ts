import { z } from "zod"

import { LIMITS } from "@/lib/app-config"

import { nameSchema } from "../artifacts/schemas"
import { inspectModelRef, providerIdSchema, type ModelSource } from "../llm/model-ref"
import type { ChatModelTask } from "../llm/task-models"
import { builtinToolNameSchema } from "../runtime/tool-names"
import type { ApprovalRequest, ToolExecutionTrace } from "../runtime/types"
import type { ReviewVerdict } from "./review"

/**
 * Workflows: a production line of agents. Each step runs one workspace agent;
 * its output is handed to the next step. Definitions live in the workspace
 * (`.black-agents/workflows/<name>.workflow.json`) so they can be committed.
 * Isomorphic — the builder UI validates with the same schema.
 */

export const MAX_WORKFLOW_STEPS = LIMITS.workflows.maxSteps
export const MAX_STEP_TURNS = LIMITS.workflows.maxStepTurns
export const DEFAULT_STEP_TURNS = LIMITS.workflows.defaultStepTurns
export const MAX_STEP_TIMEOUT_MINUTES = LIMITS.workflows.maxStepTimeoutMinutes
export const DEFAULT_STEP_TIMEOUT_MINUTES = LIMITS.workflows.defaultStepTimeoutMinutes
export const MAX_RUN_TIMEOUT_MINUTES = LIMITS.workflows.maxRunTimeoutMinutes
export const DEFAULT_RUN_TIMEOUT_MINUTES = LIMITS.workflows.defaultRunTimeoutMinutes
export const MAX_GATE_RETRIES = LIMITS.workflows.maxGateRetries
export const MAX_STEP_FILES = LIMITS.workflows.maxStepFiles
/** How many times a review may send the work back to be fixed. */
export const MAX_REVIEW_ROUNDS = LIMITS.workflows.maxReviewRounds

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
  /** Workspace file handles (`@file:<name>`) bound to this step for browser uploads or reading. */
  files: z.array(nameSchema).max(MAX_STEP_FILES).default([]),
  /** Overrides the agent's own `tools` frontmatter when set. */
  tools: z.array(builtinToolNameSchema).optional(),
  mcpServers: z.array(z.string().trim().min(1)).optional(),
  /** Auto-approve file writes in this step (commands still ask). */
  allowWrites: z.boolean().default(false),
  maxTurns: z.number().int().min(1).max(MAX_STEP_TURNS).default(DEFAULT_STEP_TURNS),
  /** Ask Jev after this step: continue, retry the step, or stop the line. */
  gate: z.boolean().default(false),
  /**
   * This step reviews the work it receives and ends with `VERDICT: approve` or
   * `VERDICT: reject`. With `selfAssess`, a reject is feedback for the reviewed agents.
   */
  review: z.boolean().default(false),
  /**
   * When this review rejects, run `step` again (with the defects) and then
   * review once more, up to `maxRounds` times.
   */
  onReject: z
    .object({
      step: stepIdSchema,
      maxRounds: z.number().int().min(1).max(MAX_REVIEW_ROUNDS).default(2),
    })
    .optional(),
  /** Skip this step until a review sends the work here. */
  repair: z.boolean().default(false),
  /**
   * This step signs in to a website. The username and password are stored as
   * secrets (`browser.<workflow>.<step>.username` / `.password`), never in this file.
   */
  login: z.boolean().default(false),
  /** Overrides the agent's and the workflow's model for this step. */
  model: z.string().trim().max(200).optional(),
  provider: providerIdSchema.optional(),
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
    provider: providerIdSchema.optional(),
    model: z.string().trim().max(200).optional(),
    trigger: workflowTriggerSchema.default({ type: "manual" }),
    steps: z.array(workflowStepSchema).min(1, "Add at least one step").max(MAX_WORKFLOW_STEPS),
    limits: z
      .object({
        stepTimeoutMinutes: z.number().int().min(1).max(MAX_STEP_TIMEOUT_MINUTES).default(DEFAULT_STEP_TIMEOUT_MINUTES),
        runTimeoutMinutes: z.number().int().min(1).max(MAX_RUN_TIMEOUT_MINUTES).default(DEFAULT_RUN_TIMEOUT_MINUTES),
        maxRetries: z.number().int().min(0).max(MAX_GATE_RETRIES).default(1),
      })
      .default({}),
    /** After each run, let each agent reflect and propose learnings (Second Brain). */
    selfAssess: z.boolean().default(false),
  })
  .superRefine((wf, ctx) => {
    const ids = new Set<string>()
    const namedByReview = new Set<string>()
    wf.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: "custom", path: ["steps", index, "id"], message: `Duplicate step id "${step.id}"` })
      }
      ids.add(step.id)
      if (step.repair && step.review) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "repair"],
          message: `Step "${step.id}" cannot both review and only run as a fix`,
        })
      }
      if (step.onReject && !step.review) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "onReject"],
          message: `Step "${step.id}": only a review step can send work back`,
        })
      }
      if (step.onReject) {
        if (step.onReject.step === step.id) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", index, "onReject", "step"],
            message: `Step "${step.id}" cannot send work back to itself`,
          })
        } else {
          const target = wf.steps.find((s) => s.id === step.onReject?.step)
          if (!target) {
            ctx.addIssue({
              code: "custom",
              path: ["steps", index, "onReject", "step"],
              message: `Step "${step.id}": send-back step "${step.onReject.step}" was not found`,
            })
          } else if (target.review) {
            ctx.addIssue({
              code: "custom",
              path: ["steps", index, "onReject", "step"],
              message: `Step "${step.id}": send work back to a work step, not another review`,
            })
          } else {
            namedByReview.add(target.id)
          }
        }
      }
      const inspected = inspectModelRef(step.model, step.provider)
      if (inspected.error) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "model"],
          message: `Step "${step.id}": ${inspected.error.message}`,
        })
      } else if (inspected.warning) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "provider"],
          message: `Step "${step.id}": ${inspected.warning}`,
        })
      }
    })
    wf.steps.forEach((step, index) => {
      if (step.repair && !namedByReview.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "repair"],
          message: `Step "${step.id}" only runs as a fix, but no review sends work to it`,
        })
      }
    })
  })
export type Workflow = z.infer<typeof workflowSchema>
export type WorkflowInput = z.input<typeof workflowSchema>

export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_login",
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
  | "waiting_login"
  | "succeeded"
  | "failed"
  | "skipped"

/** Shown while a step waits for a username and password. No secret values. */
export interface PendingLogin {
  id: string
  stepId: string
  usernameSecret: string
  passwordSecret: string
  reason: string
}

export interface StepGateResult {
  decision: "continue" | "retry" | "stop"
  by: "jev" | "default"
  confidence?: number
}

export type StepActivityKind = "waiting_model" | "running_tool" | "waiting_approval" | "idle"

/** What the step is doing right now (live runs only). */
export interface StepActivity {
  kind: StepActivityKind
  label: string
  since: string
}

/** One short line in the step's live feed. */
export interface ActivityEntry {
  at: string
  text: string
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
  /** Review steps only; missing when the reviewer gave no `VERDICT:` line. */
  verdict?: ReviewVerdict
  /** How many times this review sent the work back to be fixed. */
  sentBack?: number
  startedAt?: string
  finishedAt?: string
  /** Provider that actually ran this step. Missing on runs saved before model routing. */
  provider?: "openai" | "anthropic" | "custom"
  model?: string
  modelSource?: ModelSource
  /** Set when the step ran a task kind (`task:vision` and the rest). */
  task?: ChatModelTask
  /** Live progress while the step runs. Optional so old run files still load. */
  activity?: StepActivity
  turn?: number
  maxTurns?: number
  lastActivityAt?: string
  recent?: ActivityEntry[]
}

export interface WorkflowRun {
  id: string
  workflow: string
  workspaceRoot: string
  status: RunStatus
  trigger: "manual" | "schedule"
  task: string
  /** The project scope this run used, or absent for the whole workspace. */
  projectScope?: string
  /** Optional per-step file overrides for this run (`stepId -> fileNames[]`). */
  stepFiles?: Record<string, string[]>
  /** Snapshot of workflow limits at start (for live UI timers). */
  limits?: {
    stepTimeoutMinutes: number
    runTimeoutMinutes: number
    maxRetries: number
  }
  createdAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
  /** Short end-of-run summary (last output, or why it stopped). */
  report?: string
  steps: StepRun[]
  pendingApproval?: ApprovalRequest | null
  pendingLogin?: PendingLogin | null
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
