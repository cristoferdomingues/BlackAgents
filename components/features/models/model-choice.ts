import type { ChatModelTask } from "@/lib/llm/task-models"
import {
  inspectModelRef,
  isAgentModelAlias,
  isProviderId,
  pickModelLayer,
  type ModelLayer,
  type ModelRef,
  type ModelSource,
} from "@/lib/llm/model-ref"
import type { ProviderId } from "@/lib/llm/types"

/**
 * Shared model-choice helpers for the agent editor, workflow steps, chat
 * header, and run view. A choice is inherit, a real provider, or a chat task.
 */

export const MODEL_SELECT_VALUES = [
  "inherit",
  "openai",
  "anthropic",
  "custom",
  "task:vision",
  "task:fast",
  "task:reasoning",
] as const

export type ModelSelectValue = (typeof MODEL_SELECT_VALUES)[number]

export const PROVIDER_OPTIONS: Array<{ id: ProviderId; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "custom", label: "Custom" },
]

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom",
}

export interface ModelFormFields {
  modelChoice: ModelSelectValue
  modelId: string
  /** Claude / Cursor alias kept on disk until the user changes the choice. */
  modelAlias: string
}

export interface TaskChoiceMap {
  vision?: { provider: ProviderId; model: string }
  fast?: { provider: ProviderId; model: string }
  reasoning?: { provider: ProviderId; model: string }
}

export interface ResolvedHeaderModel {
  provider: string
  model: string
  source: string
  task?: string
}

export function providerLabel(id: ProviderId): string {
  return PROVIDER_LABEL[id]
}

export function parseModelSelectValue(value: string): ModelSelectValue {
  for (const option of MODEL_SELECT_VALUES) {
    if (option === value) return option
  }
  return "inherit"
}

export function isTaskSelectValue(
  value: string
): value is "task:vision" | "task:fast" | "task:reasoning" {
  return value === "task:vision" || value === "task:fast" || value === "task:reasoning"
}

export function taskFromSelect(value: ModelSelectValue): ChatModelTask | null {
  if (value === "task:vision") return "vision"
  if (value === "task:fast") return "fast"
  if (value === "task:reasoning") return "reasoning"
  return null
}

function safeRef(model: unknown, provider: unknown): ModelRef {
  const inspected = inspectModelRef(model, provider)
  return inspected.error ? { kind: "inherit" } : inspected.ref
}

/** Load agent or step frontmatter into the editor controls. Aliases stay inherit. */
export function modelFormFromFrontmatter(model: unknown, provider: unknown): ModelFormFields {
  const raw = typeof model === "string" ? model.trim() : ""
  if (raw && isAgentModelAlias(raw)) {
    return { modelChoice: "inherit", modelId: "", modelAlias: raw }
  }
  const ref = safeRef(model, provider)
  if (ref.kind === "task") {
    return { modelChoice: `task:${ref.task}`, modelId: "", modelAlias: "" }
  }
  if (ref.kind === "id") {
    return {
      modelChoice: ref.provider ?? "inherit",
      modelId: ref.model,
      modelAlias: "",
    }
  }
  return { modelChoice: "inherit", modelId: "", modelAlias: "" }
}

/**
 * Agent save payload. `null` clears a key. An untouched alias is written back
 * so it stays on disk. A provider is never sent without a model id.
 */
export function agentModelExtra(values: ModelFormFields): {
  model: string | null
  provider: ProviderId | null
} {
  const task = taskFromSelect(values.modelChoice)
  if (task) return { model: `task:${task}`, provider: null }
  if (isProviderId(values.modelChoice)) {
    const model = values.modelId.trim()
    if (!model) return { model: null, provider: null }
    return { model, provider: values.modelChoice }
  }
  if (values.modelAlias) return { model: values.modelAlias, provider: null }
  const model = values.modelId.trim()
  if (model) return { model, provider: null }
  return { model: null, provider: null }
}

export function stepModelFields(
  choice: ModelSelectValue,
  model: string
): { model?: string; provider?: ProviderId } {
  const task = taskFromSelect(choice)
  if (task) return { model: `task:${task}` }
  const trimmed = model.trim()
  if (isProviderId(choice)) {
    if (!trimmed) return {}
    return { model: trimmed, provider: choice }
  }
  if (trimmed) return { model: trimmed }
  return {}
}

/** Block a provider with no model id. That payload is rejected on save. */
export function stepModelIssue(choice: ModelSelectValue, model: string, stepId: string): string | null {
  if (isProviderId(choice) && !model.trim()) {
    return `Step "${stepId}": Choose a model`
  }
  return null
}

export function effectiveModelText(input: {
  stepModel?: string
  stepProvider?: string
  agentModel?: unknown
  agentProvider?: unknown
  workflowModel?: string
  workflowProvider?: string
  tasks: TaskChoiceMap
}): string {
  const layers: ModelLayer[] = [
    { source: "step", ref: safeRef(input.stepModel, input.stepProvider) },
    { source: "agent", ref: safeRef(input.agentModel, input.agentProvider) },
    { source: "workflow", ref: safeRef(input.workflowModel, input.workflowProvider) },
  ]
  const winner = pickModelLayer(layers)
  if (!winner || winner.ref.kind === "inherit") return "Assistant default"
  if (winner.ref.kind === "id") return `${winner.ref.model} · from ${winner.source}`
  const choice = input.tasks[winner.ref.task]
  const target = choice ? `${choice.model} (${providerLabel(choice.provider)})` : "not set"
  return `task:${winner.ref.task} → ${target} · from ${winner.source}`
}

export function taskChoiceSummary(
  task: ChatModelTask,
  choice: { provider: ProviderId; model: string } | undefined
): string {
  if (!choice) return `task:${task} → not set`
  return `task:${task} → ${choice.model} (${providerLabel(choice.provider)})`
}

/** Badge before a reply, then the resolved provider, model, source, and task. */
export function agentHeaderSummary(ref: ModelRef, resolved: ResolvedHeaderModel | null): string | null {
  if (resolved && (ref.kind === "id" || ref.kind === "task" || resolved.source === "agent")) {
    const task = resolved.task ? `task:${resolved.task} → ` : ""
    return `${task}${resolved.model} · ${resolved.provider} · from ${resolved.source}`
  }
  if (ref.kind === "task") return `task:${ref.task} · from agent`
  if (ref.kind === "id") return `${ref.model} · from agent`
  return null
}

export function formatRunStepModel(step: {
  provider?: ProviderId
  model?: string
  modelSource?: ModelSource
  task?: ChatModelTask
}): string | null {
  if (!step.provider && !step.model && !step.modelSource && !step.task) return null
  const head = [step.provider ? providerLabel(step.provider) : undefined, step.model].filter(
    (part): part is string => Boolean(part)
  )
  const bits = [head.join(" · "), step.modelSource ? `from ${step.modelSource}` : undefined]
  if (step.task) bits.push(`task:${step.task}`)
  return bits.filter((part): part is string => Boolean(part && part.length > 0)).join(" · ")
}
