import { choice, noul } from "@typesafe-ai/sdk"

import {
  DECISION_REQUEST_OPTIONS,
  decisionErrorMessage,
  type ResolvedDecisionClient,
} from "./client"

/** Act on a step-gate label only at this confidence. */
export const STEP_GATE_MIN_CONFIDENCE = 0.85
/** Skip a scheduled run only when Jev is this sure and sees no action needed. */
export const PREFLIGHT_SKIP_CONFIDENCE = 0.95
export const PREFLIGHT_ACTION_NOUL_MAX = 0.05

const STATE_TEXT_MAX = 4_000
const GATE_LABELS = ["continue", "retry", "stop"] as const
type GateLabel = (typeof GATE_LABELS)[number]

function isGateLabel(value: string): value is GateLabel {
  return (GATE_LABELS as readonly string[]).includes(value)
}

function clip(text: string): string {
  return text.length > STATE_TEXT_MAX ? `${text.slice(0, STATE_TEXT_MAX)}…` : text
}

export type StepGateDecision =
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "decided"; label: GateLabel; confidence: number; model: string }

/**
 * After a workflow step: is the output good enough to hand on, should the
 * step try again, or is the line done early? Never throws.
 */
export async function evaluateStepGate(params: {
  resolved: ResolvedDecisionClient | null
  workflow: string
  task: string
  stepId: string
  agent: string
  instructions: string
  output: string
  isLastStep: boolean
}): Promise<StepGateDecision> {
  if (!params.resolved) return { kind: "unavailable" }
  try {
    const result = await params.resolved.client.systemOne(
      {
        state: {
          trigger: "workflow_step_gate",
          workflow: params.workflow,
          task: clip(params.task),
          step: { id: params.stepId, agent: params.agent, instructions: clip(params.instructions) },
          output: clip(params.output),
          isLastStep: params.isLastStep,
        },
        questions: {
          next: choice("What should the workflow do with this step's output?", {
            continue: "The output does the step's job; hand it to the next step.",
            retry: "The output is incomplete or off-task; run this step again.",
            stop: "The task is already fully done or cannot continue; stop the line here.",
          }),
        },
      },
      DECISION_REQUEST_OPTIONS
    )
    const answer = result.answers.next
    if (!isGateLabel(answer.choice)) {
      return { kind: "error", message: `Unknown gate label: ${answer.choice}` }
    }
    return { kind: "decided", label: answer.choice, confidence: answer.confidence, model: result.model }
  } catch (err) {
    return { kind: "error", message: decisionErrorMessage(err, "Jev step gate failed") }
  }
}

export type WorkflowPreflightDecision =
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "run"; confidence: number; noul: number }
  | { kind: "skip"; confidence: number; noul: number; model: string }

/** Before a scheduled run: is there anything new to do? Never throws. */
export async function evaluateWorkflowPreflight(params: {
  resolved: ResolvedDecisionClient | null
  workflow: string
  description: string
  task: string
  lastRun: { status: string; finishedAt?: string; report?: string } | null
  changedFiles: string[]
}): Promise<WorkflowPreflightDecision> {
  if (!params.resolved) return { kind: "unavailable" }
  try {
    const result = await params.resolved.client.systemOne(
      {
        state: {
          trigger: "workflow_schedule",
          workflow: params.workflow,
          description: params.description,
          task: clip(params.task),
          lastRun: params.lastRun
            ? { ...params.lastRun, report: clip(params.lastRun.report ?? "") }
            : null,
          changedFilesSinceLastRun: params.changedFiles.slice(0, 50),
        },
        questions: {
          actionRequired: noul("Does this scheduled workflow have new work to do?", {
            true: "Something changed or the task needs a fresh run.",
            false: "Nothing changed since the last successful run.",
          }),
          next: choice("What should the scheduler do?", {
            skip: "Skip this run; nothing material changed.",
            run: "Run the workflow.",
          }),
        },
      },
      DECISION_REQUEST_OPTIONS
    )
    const noulScore = result.answers.actionRequired.noul
    const next = result.answers.next
    if (
      next.choice === "skip" &&
      next.confidence >= PREFLIGHT_SKIP_CONFIDENCE &&
      noulScore <= PREFLIGHT_ACTION_NOUL_MAX
    ) {
      return { kind: "skip", confidence: next.confidence, noul: noulScore, model: result.model }
    }
    return { kind: "run", confidence: next.confidence, noul: noulScore }
  } catch (err) {
    return { kind: "error", message: decisionErrorMessage(err, "Jev preflight failed") }
  }
}
