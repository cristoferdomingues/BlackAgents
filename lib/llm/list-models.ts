import { z } from "zod"

import type { ModelInfo } from "./task-models"
import { ProviderError } from "./types"

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
    })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
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

export function filterModels(models: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter((m) => m.toLowerCase().includes(q))
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}
