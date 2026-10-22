import type { Artifact } from "@/lib/artifacts/types"

import { isProviderId, providerIdSchema } from "./provider-id"
import { chatModelTaskSchema, MODEL_TASKS, type ChatModelTask } from "./task-models"
import type { ProviderId } from "./types"

export { isProviderId, providerIdSchema }

/**
 * One shared way to read a model choice. A layer may inherit, name a model id,
 * or name a chat task kind (`task:vision`). The most specific layer wins.
 */

/** Claude Code / Cursor aliases. Kept on disk; never sent to a provider. */
export const AGENT_MODEL_ALIASES = ["sonnet", "opus", "haiku", "fast"] as const

const ALIAS_SET = new Set<string>(AGENT_MODEL_ALIASES)

export type ModelRef =
  | { kind: "inherit" }
  | { kind: "id"; model: string; provider?: ProviderId }
  | { kind: "task"; task: ChatModelTask }

export type ModelSource = "step" | "agent" | "workflow" | "assistant"

export interface ModelLayer {
  source: ModelSource
  ref: ModelRef
}

export interface ResolvedModelChoice {
  provider: ProviderId
  model: string
  source: ModelSource
  /** Set when the choice came from a task kind. */
  task?: ChatModelTask
}

/** A winning layer whose provider may still come from a lower layer. */
export interface LayeredModelSelection {
  provider?: ProviderId
  model: string
  source: ModelSource
  task?: ChatModelTask
}

export type ModelRefErrorCode =
  | "unknown_task"
  | "not_chat_task"
  | "unknown_provider"
  | "task_provider"
  | "invalid_model"
  | "model_too_long"
  | "task_unset"
  | "unverified"

export class ModelRefError extends Error {
  readonly status: 400 | 412
  readonly code: ModelRefErrorCode

  constructor(message: string, status: 400 | 412, code: ModelRefErrorCode) {
    super(message)
    this.name = "ModelRefError"
    this.status = status
    this.code = code
  }
}

export interface ModelRefInspection {
  ref: ModelRef
  /** Set when a provider was sent without a model id. Callers may warn or reject. */
  warning?: string
  /** Set when the raw value cannot be used. {@link parseModelRef} throws this. */
  error?: ModelRefError
}

const LONE_PROVIDER_WARNING = "A provider without a model is ignored"
const MAX_MODEL_LENGTH = 200

export function isAgentModelAlias(model: string): boolean {
  return ALIAS_SET.has(model)
}

function blankModel(model: unknown): boolean {
  if (model === undefined || model === null) return true
  if (typeof model !== "string") return false
  const trimmed = model.trim()
  return trimmed === "" || trimmed === "inherit"
}

function readProvider(provider: unknown): { provider?: ProviderId; error?: ModelRefError } {
  if (provider === undefined || provider === null) return {}
  if (typeof provider !== "string") {
    return {
      error: new ModelRefError(`Unknown provider "${String(provider)}"`, 400, "unknown_provider"),
    }
  }
  const trimmed = provider.trim()
  if (!trimmed) return {}
  if (!isProviderId(trimmed)) {
    return {
      error: new ModelRefError(`Unknown provider "${trimmed}"`, 400, "unknown_provider"),
    }
  }
  return { provider: trimmed }
}

/** Parse raw frontmatter or JSON. Throws {@link ModelRefError} on a bad value. */
export function parseModelRef(model: unknown, provider: unknown): ModelRef {
  const inspected = inspectModelRef(model, provider)
  if (inspected.error) throw inspected.error
  return inspected.ref
}

/**
 * Same rules as {@link parseModelRef}, plus a warning when a provider is set
 * without a usable model. Never throws.
 */
export function inspectModelRef(model: unknown, provider: unknown): ModelRefInspection {
  const read = readProvider(provider)
  if (read.error) return { ref: { kind: "inherit" }, error: read.error }

  if (model !== undefined && model !== null && typeof model !== "string") {
    return { ref: { kind: "inherit" }, error: new ModelRefError("Invalid model", 400, "invalid_model") }
  }

  if (blankModel(model)) {
    return read.provider
      ? { ref: { kind: "inherit" }, warning: LONE_PROVIDER_WARNING }
      : { ref: { kind: "inherit" } }
  }

  const trimmed = (model as string).trim()
  if (trimmed.length > MAX_MODEL_LENGTH) {
    return { ref: { kind: "inherit" }, error: new ModelRefError("Model id is too long", 400, "model_too_long") }
  }

  if (trimmed.startsWith("task:")) {
    if (read.provider) {
      return {
        ref: { kind: "inherit" },
        error: new ModelRefError("A task kind cannot set a provider", 400, "task_provider"),
      }
    }
    const kind = trimmed.slice("task:".length)
    if (kind === "voice" || kind === "video") {
      return {
        ref: { kind: "inherit" },
        error: new ModelRefError(`"${kind}" is not a chat model task`, 400, "not_chat_task"),
      }
    }
    const parsed = chatModelTaskSchema.safeParse(kind)
    if (!parsed.success) {
      return {
        ref: { kind: "inherit" },
        error: new ModelRefError(`Unknown model task "${kind}"`, 400, "unknown_task"),
      }
    }
    return { ref: { kind: "task", task: parsed.data } }
  }

  if (isAgentModelAlias(trimmed)) {
    return read.provider
      ? { ref: { kind: "inherit" }, warning: LONE_PROVIDER_WARNING }
      : { ref: { kind: "inherit" } }
  }

  return {
    ref: read.provider
      ? { kind: "id", model: trimmed, provider: read.provider }
      : { kind: "id", model: trimmed },
  }
}

/** First layer that is not "inherit"; undefined when all inherit. */
export function pickModelLayer(layers: ModelLayer[]): ModelLayer | undefined {
  return layers.find((layer) => layer.ref.kind !== "inherit")
}

/** The agent's layer, read from its frontmatter (aliases → inherit). */
export function agentModelLayer(agent: Artifact): ModelLayer {
  if (agent.type !== "agent") return { source: "agent", ref: { kind: "inherit" } }
  return {
    source: "agent",
    ref: parseModelRef(agent.frontmatter.model, agent.frontmatter.provider),
  }
}

export interface TaskModelSettings {
  models: Partial<Record<ChatModelTask, { provider: ProviderId; model: string }>>
}

/** The saved model for a chat task kind. Throws 412 when that kind is unset. */
export function resolveTaskRef(
  task: ChatModelTask,
  settings: TaskModelSettings
): { provider: ProviderId; model: string } {
  const choice = settings.models[task]
  if (!choice?.model || !choice.provider) {
    throw new ModelRefError(
      `Set the ${MODEL_TASKS[task].label} model in Settings → Models`,
      412,
      "task_unset"
    )
  }
  return { provider: choice.provider, model: choice.model }
}

/**
 * Pick the winning layer. An id without a provider uses the next layer that
 * names one (a task kind's provider counts). `undefined` means every layer
 * inherits.
 */
export function selectLayeredModel(
  layers: ModelLayer[],
  resolveTask: (task: ChatModelTask) => { provider: ProviderId; model: string }
): LayeredModelSelection | undefined {
  const index = layers.findIndex((layer) => layer.ref.kind !== "inherit")
  if (index < 0) return undefined
  const winner = layers[index]
  if (!winner) return undefined

  if (winner.ref.kind === "task") {
    const choice = resolveTask(winner.ref.task)
    return {
      provider: choice.provider,
      model: choice.model,
      source: winner.source,
      task: winner.ref.task,
    }
  }

  if (winner.ref.kind !== "id") return undefined
  let provider = winner.ref.provider
  if (!provider) {
    for (const lower of layers.slice(index + 1)) {
      if (lower.ref.kind === "id" && lower.ref.provider) {
        provider = lower.ref.provider
        break
      }
      if (lower.ref.kind === "task") {
        provider = resolveTask(lower.ref.task).provider
        break
      }
    }
  }
  return {
    ...(provider ? { provider } : {}),
    model: winner.ref.model,
    source: winner.source,
  }
}

export function unverifiedProviderMessage(
  subject: { kind: "agent"; name: string } | { kind: "step"; id: string },
  providerLabel: string
): string {
  const who = subject.kind === "agent" ? `Agent "${subject.name}"` : `Step "${subject.id}"`
  return `${who} uses ${providerLabel}, which is not verified. Verify it under AI Providers.`
}
