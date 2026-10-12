import { z } from "zod"

import { getProviderSecret } from "@/lib/secrets"

import { getProvider } from "./registry"
import type { ModelInfo } from "./task-models"
import { ProviderError, type ProviderId } from "./types"

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>
}

/**
 * Lists model ids from an OpenAI-compatible `/models` endpoint.
 * Used for OpenAI itself and for the custom (base-URL) provider.
 */
export async function listOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers,
  })

  const json = (await res.json().catch(() => null)) as OpenAIModelsResponse | null
  if (!res.ok) {
    throw new ProviderError(
      `Could not list models (${res.status})`,
      res.status
    )
  }

  const ids = (json?.data ?? [])
    .map((m) => m.id?.trim())
    .filter((id): id is string => Boolean(id))

  return uniqueSorted(ids)
}

const modelsWithModalitiesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().trim().min(1),
      name: z.string().optional(),
      architecture: z
        .object({
          input_modalities: z.array(z.string()).optional(),
          output_modalities: z.array(z.string()).optional(),
        })
        .optional(),
      supported_parameters: z.array(z.string()).optional(),
    })
  ),
})

/**
 * Like {@link listOpenAICompatibleModels}, but keeps names and input/output
 * modalities when the endpoint publishes them (OpenRouter does).
 */
export async function listModelsWithModalities(
  baseUrl: string,
  apiKey: string
): Promise<ModelInfo[]> {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers })
  const json = (await res.json().catch(() => null)) as unknown
  if (!res.ok) throw new ProviderError(`Could not list models (${res.status})`, res.status)

  const parsed = modelsWithModalitiesSchema.safeParse(json)
  if (!parsed.success) throw new ProviderError("The provider returned an unexpected model list", 502)

  const seen = new Set<string>()
  const models: ModelInfo[] = []
  for (const m of parsed.data.data) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    models.push({
      id: m.id,
      ...(m.name ? { name: m.name } : {}),
      ...(m.architecture?.input_modalities
        ? { inputModalities: m.architecture.input_modalities }
        : {}),
      ...(m.architecture?.output_modalities
        ? { outputModalities: m.architecture.output_modalities }
        : {}),
      ...(m.supported_parameters ? { supportedParameters: m.supported_parameters } : {}),
    })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

export interface ProviderModelList {
  models: ModelInfo[]
  source: "static" | "live"
  warning?: string
}

/**
 * Models for a provider picker. Anthropic is the curated list. OpenAI merges
 * a live `/models` list onto that catalog. Custom keeps modality metadata.
 */
export async function listProviderModels(id: ProviderId): Promise<ProviderModelList> {
  const provider = getProvider(id)
  if (!provider) return { models: [], source: "static" }
  const secret = await getProviderSecret(id)
  const staticModels: ModelInfo[] = provider.models.map((modelId) => ({ id: modelId }))

  if (id === "anthropic") return { models: staticModels, source: "static" }

  const canListLive =
    (id === "openai" && Boolean(secret?.apiKey)) || (id === "custom" && Boolean(secret?.baseUrl))
  if (!canListLive) return { models: staticModels, source: "static" }

  const baseUrl = id === "openai" ? "https://api.openai.com/v1" : secret?.baseUrl
  if (!baseUrl) return { models: staticModels, source: "static" }
  const apiKey = secret?.apiKey ?? ""

  try {
    if (id === "custom") {
      const live = await listModelsWithModalities(baseUrl, apiKey)
      return { models: mergeModelInfo(staticModels, live), source: "live" }
    }
    const live = await listOpenAICompatibleModels(baseUrl, apiKey)
    return {
      models: mergeModelLists(provider.models, live).map((modelId) => ({ id: modelId })),
      source: "live",
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      return { models: staticModels, source: "static", warning: err.message }
    }
    throw err
  }
}

function mergeModelInfo(primary: ModelInfo[], extra: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  const out: ModelInfo[] = []
  for (const model of [...primary, ...extra]) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

/** Prefer first-seen order (static curated models stay on top). */
export function mergeModelLists(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const raw of list) {
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

export { filterModels } from "./filter-models"

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}
