import type { Artifact } from "@/lib/artifacts/types"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { CredentialStateError, getVerifiedCredentials } from "@/lib/llm/credentials"
import {
  agentModelLayer,
  ModelRefError,
  parseModelRef,
  resolveTaskRef,
  selectLayeredModel,
  unverifiedProviderMessage,
  type ModelLayer,
  type ModelSource,
} from "@/lib/llm/model-ref"
import { getProvider, PROVIDER_IDS } from "@/lib/llm/registry"
import type { ChatModelTask } from "@/lib/llm/task-models"
import type { LLMCredentials, LLMProvider, ProviderId } from "@/lib/llm/types"
import { readSecrets, type ProviderSecret } from "@/lib/secrets"
import { readAiSettings, type AiSettings } from "@/lib/settings"

import type { Workflow, WorkflowStep } from "./schema"

export interface ResolvedLlm {
  provider: LLMProvider
  credentials: LLMCredentials
  secret: ProviderSecret
  model: string
  source?: ModelSource
  task?: ChatModelTask
}

export interface ResolveLlmOptions {
  settings?: AiSettings
  stepId?: string
  agentName?: string
  /** Rewrite a missing-key error to name the agent or the step. */
  blame?: "step" | "agent"
  /** Used when every layer inherits, or a model id names no provider. */
  fallbackProvider?: ProviderId
  fallbackSource?: ModelSource
  cache?: Map<string, ResolvedLlm>
}

export interface LegacyLlmChoice {
  provider?: ProviderId
  model?: string
}

/**
 * Pick the LLM for a run from the most specific layer, then the fallback
 * provider, then Assistant defaults, then the first verified provider.
 */
export async function resolveRunLlm(layers: ModelLayer[], options?: ResolveLlmOptions): Promise<ResolvedLlm>
/** Older call sites pass only a workflow-level provider and model. */
export async function resolveRunLlm(choice: LegacyLlmChoice): Promise<ResolvedLlm>
export async function resolveRunLlm(
  layersOrChoice: ModelLayer[] | LegacyLlmChoice,
  options?: ResolveLlmOptions
): Promise<ResolvedLlm> {
  if (Array.isArray(layersOrChoice)) return resolveLayers(layersOrChoice, options)
  const model = layersOrChoice.model?.trim()
  const layers: ModelLayer[] = model
    ? [{ source: "workflow", ref: parseModelRef(model, layersOrChoice.provider) }]
    : []
  return resolveLayers(layers, {
    fallbackProvider: layersOrChoice.provider,
    fallbackSource: layersOrChoice.provider ? "workflow" : "assistant",
  })
}

async function resolveLayers(layers: ModelLayer[], options?: ResolveLlmOptions): Promise<ResolvedLlm> {
  const needsTask = layers.some((layer) => layer.ref.kind === "task")
  const settings = needsTask ? (options?.settings ?? (await readAiSettings())) : options?.settings
  const selected = selectLayeredModel(layers, (task) => {
    if (!settings) {
      throw new ModelRefError("Set the model in Settings → AI → Models by task", 412, "task_unset")
    }
    return resolveTaskRef(task, settings)
  })

  const secrets = await readSecrets()
  const verified = PROVIDER_IDS.filter((id) => secrets.providers[id]?.verification?.status === "valid")
  const providerId = selected?.provider ?? options?.fallbackProvider ?? secrets.defaults?.provider ?? verified[0]
  const provider = providerId ? getProvider(providerId) : undefined
  if (!provider) throw new Error("No verified AI provider. Verify one under AI Providers.")

  const model =
    selected?.model?.trim() ||
    (secrets.defaults?.provider === provider.id ? secrets.defaults.model : undefined) ||
    provider.models[0]
  if (!model) throw new Error(`Choose a model for ${provider.label} in the workflow settings`)

  const source: ModelSource = selected?.source ?? options?.fallbackSource ?? "assistant"
  const cacheKey = `${provider.id}\0${model}`
  const cached = options?.cache?.get(cacheKey)
  if (cached) {
    return { ...cached, model, source, ...(selected?.task ? { task: selected.task } : { task: undefined }) }
  }

  try {
    const { credentials, secret } = await getVerifiedCredentials(provider)
    const resolved: ResolvedLlm = {
      provider,
      credentials,
      secret,
      model,
      source,
      ...(selected?.task ? { task: selected.task } : {}),
    }
    options?.cache?.set(cacheKey, resolved)
    return resolved
  } catch (err) {
    if (err instanceof CredentialStateError && options?.blame === "step" && options.stepId) {
      throw new ModelRefError(
        unverifiedProviderMessage({ kind: "step", id: options.stepId }, provider.label),
        412,
        "unverified"
      )
    }
    if (err instanceof CredentialStateError && options?.blame === "agent" && options.agentName) {
      throw new ModelRefError(
        unverifiedProviderMessage({ kind: "agent", name: options.agentName }, provider.label),
        412,
        "unverified"
      )
    }
    throw err
  }
}

/** Step → agent → workflow. A missing agent inherits. */
export function stepModelLayers(
  workflow: Workflow,
  step: WorkflowStep,
  agent: Artifact | undefined
): ModelLayer[] {
  return [
    { source: "step", ref: parseModelRef(step.model, step.provider) },
    agent ? agentModelLayer(agent) : { source: "agent", ref: { kind: "inherit" } },
    { source: "workflow", ref: parseModelRef(workflow.model, workflow.provider) },
  ]
}

export function stepResolveOptions(
  workflow: Workflow,
  step: WorkflowStep,
  agent: Artifact | undefined,
  settings: AiSettings,
  cache?: Map<string, ResolvedLlm>
): ResolveLlmOptions {
  return {
    settings,
    stepId: step.id,
    agentName: agent?.name,
    blame: "step",
    fallbackProvider: workflow.provider,
    fallbackSource: workflow.provider ? "workflow" : "assistant",
    cache,
  }
}

/**
 * Resolve every step before a run starts. The first failure (412 or 400) wins.
 * Hand-written agent frontmatter errors are named with the step id.
 */
export async function ensureWorkflowModels(
  root: string,
  workflow: Workflow,
  resolve: (layers: ModelLayer[], options?: ResolveLlmOptions) => Promise<ResolvedLlm>
): Promise<void> {
  const [settings, artifacts] = await Promise.all([readAiSettings(), scanWorkspace(root)])
  const cache = new Map<string, ResolvedLlm>()
  for (const step of workflow.steps) {
    const agent = artifacts.find((item) => item.type === "agent" && item.name === step.agent)
    try {
      await resolve(stepModelLayers(workflow, step, agent), stepResolveOptions(workflow, step, agent, settings, cache))
    } catch (err) {
      if (err instanceof ModelRefError && err.status === 400 && !err.message.startsWith(`Step "${step.id}":`)) {
        throw new ModelRefError(`Step "${step.id}": ${err.message}`, 400, err.code)
      }
      throw err
    }
  }
}
