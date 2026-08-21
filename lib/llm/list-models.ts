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
