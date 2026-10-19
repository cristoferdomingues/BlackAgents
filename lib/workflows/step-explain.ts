import {
  ABILITY_LEVELS,
  abilityChoiceOf,
  riskOfTools,
  type AbilityRisk,
} from "@/lib/artifacts/abilities"
import {
  DEFAULT_AGENT_TOOLS,
  expandBuiltinTools,
  FILE_WRITE_TOOLS,
  isBuiltinToolName,
  type BuiltinToolName,
} from "@/lib/runtime/tool-names"
import type { WorkflowStep } from "@/lib/workflows/schema"

/**
 * Words and small rules for the workflow step form. Isomorphic: the builder
 * shows them and unit tests check them.
 */

export type StepKind = "work" | "review" | "login"
export type StepInput = WorkflowStep["input"]

export const STEP_KIND_ORDER: StepKind[] = ["work", "review", "login"]

export const STEP_KINDS: Record<StepKind, { label: string; summary: string; placeholder: string }> = {
  work: {
    label: "Do the work",
    summary: "The agent works on the task and hands its result to the next step.",
    placeholder: "Plan the feature and list the files to change.",
  },
  review: {
    label: "Review earlier work",
    summary: "The agent checks what earlier steps did and ends with approve or reject.",
    placeholder: "Check the plan and the code. Reject if tests are missing.",
  },
  login: {
    label: "Sign in to a website",
    summary: "The agent signs in with a saved username and password, then goes on.",
    placeholder: "Open the admin page and sign in.",
  },
}

/** Sign in wins when a saved step has both flags, so nothing is lost on save. */
export function stepKindOf(step: { review: boolean; login: boolean }): StepKind {
  if (step.login) return "login"
  if (step.review) return "review"
  return "work"
}

export function stepKindFlags(kind: StepKind): { review: boolean; login: boolean } {
  return { review: kind === "review", login: kind === "login" }
}

export const STEP_INPUT_ORDER: StepInput[] = ["previous", "all", "task"]

export const STEP_INPUTS: Record<StepInput, { label: string; link: string; summary: string }> = {
  previous: {
    label: "Previous step output",
    link: "Gets the previous step's result",
    summary: "Good for a chain: plan, then build, then test.",
  },
  all: {
    label: "All earlier outputs",
    link: "Gets every earlier result",
    summary: "Good for reviews and final reports.",
  },
  task: {
    label: "Only the task",
    link: "Starts fresh from the task",
    summary: "Ignores earlier steps. Good for work that does not depend on them.",
  },
}

/** The text on the link above a step in the flow line. */
export function stepLinkText(index: number, input: StepInput): string {
  if (index === 0) return "Starts with the task"
  return STEP_INPUTS[input].link
}

/** A review reads all earlier work unless the user picked something else on purpose. */
export function inputForKind(kind: StepKind, current: StepInput): StepInput {
  return kind === "review" && current === "previous" ? "all" : current
}

/** The built-in tools an agent file gives; no `tools` list means read-only. */
export function agentBuiltinTools(frontmatter: Record<string, unknown> | undefined): BuiltinToolName[] {
  const raw = frontmatter?.tools
  if (!Array.isArray(raw)) return [...DEFAULT_AGENT_TOOLS]
  return raw.filter(isBuiltinToolName)
}

export function abilityLabel(tools: readonly BuiltinToolName[]): string {
  if (tools.length === 0) return "Talk only"
  const choice = abilityChoiceOf(tools)
  return choice === "custom" ? "Custom tools" : ABILITY_LEVELS[choice].label
}

export interface StepAbility {
  label: string
  risk: AbilityRisk
  canWrite: boolean
  fromAgent: boolean
}

/** What the step can do: its own tools, or the agent's when it uses them. */
export function stepAbility(params: {
  ownTools: boolean
  tools: readonly BuiltinToolName[]
  agentTools: readonly BuiltinToolName[] | null
}): StepAbility | null {
  const tools = params.ownTools ? params.agentTools : params.tools
  if (!tools) return null
  const expanded = expandBuiltinTools(tools)
  return {
    label: abilityLabel(tools),
    risk: riskOfTools(expanded),
    canWrite: expanded.some((name) => FILE_WRITE_TOOLS.includes(name)),
    fromAgent: params.ownTools,
  }
}

/** Short facts for a closed step card. */
export function stepFacts(params: {
  kind: StepKind
  ability: StepAbility | null
  gate: boolean
  allowWrites: boolean
  files: number
  repair?: boolean
  sendBack?: boolean
}): string[] {
  const facts: string[] = []
  if (params.kind === "review") facts.push("Review")
  if (params.kind === "login") facts.push("Signs in")
  if (params.repair) facts.push("Fixes a rejection")
  if (params.sendBack) facts.push("Sends back if rejected")
  if (params.ability) facts.push(params.ability.label)
  if (params.ability?.canWrite && params.allowWrites) facts.push("Writes without asking")
  if (params.gate) facts.push("Jev checks")
  if (params.files > 0) facts.push(params.files === 1 ? "1 file" : `${params.files} files`)
  return facts
}

/** The step index a save error points at (`steps.2.id` → 2), if any. */
export function stepIndexOfIssue(path: readonly PropertyKey[]): number | null {
  if (path[0] !== "steps" || typeof path[1] !== "number") return null
  return path[1]
}
