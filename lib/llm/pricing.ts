import { z } from "zod"

import type { ModelPrice } from "@/lib/chat/usage"
import { isOpenRouterBaseUrl } from "@/lib/decision/client"

import type { LLMCredentials, ProviderId } from "./types"

/**
 * Public list prices in US dollars per million tokens. They change, so the
 * screen calls them an estimate. A model id matches the longest prefix that
 * ends at the id's end or at a "-" (so dated ids like claude-sonnet-4-20250514 match).
 */
const LIST_PRICES: Readonly<Record<"openai" | "anthropic", ReadonlyArray<readonly [string, number, number]>>> = {
  openai: [
    ["gpt-5", 1.25, 10],
    ["gpt-5-mini", 0.25, 2],
    ["gpt-5-nano", 0.05, 0.4],
    ["gpt-4.1", 2, 8],
    ["gpt-4.1-mini", 0.4, 1.6],
    ["gpt-4.1-nano", 0.1, 0.4],
    ["gpt-4o", 2.5, 10],
    ["gpt-4o-mini", 0.15, 0.6],
    ["o1", 15, 60],
    ["o3", 2, 8],
    ["o3-mini", 1.1, 4.4],
    ["o4-mini", 1.1, 4.4],
  ],
  anthropic: [
    ["claude-opus-4", 15, 75],
    ["claude-opus-4-5", 5, 25],
    ["claude-sonnet-4", 3, 15],
    ["claude-haiku-4-5", 1, 5],
    ["claude-3-7-sonnet", 3, 15],
    ["claude-3-5-sonnet", 3, 15],
    ["claude-3-5-haiku", 0.8, 4],
    ["claude-3-opus", 15, 75],
    ["claude-3-haiku", 0.25, 1.25],
  ],
}

export function listPrice(provider: ProviderId, model: string): ModelPrice | null {
  if (provider !== "openai" && provider !== "anthropic") return null
  const id = model.trim().toLowerCase()
  let best: readonly [string, number, number] | null = null
  for (const row of LIST_PRICES[provider]) {
    const [prefix] = row
    const fits = id === prefix || id.startsWith(`${prefix}-`)
    if (fits && (!best || prefix.length > best[0].length)) best = row
  }
  return best ? { inputPerMTok: best[1], outputPerMTok: best[2], source: "list" } : null
}

const openRouterModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      pricing: z.object({ prompt: z.string(), completion: z.string() }).optional(),
    })
  ),
})

const OPENROUTER_PRICE_TTL_MS = 60 * 60_000
const OPENROUTER_PRICE_TIMEOUT_MS = 3_000

let openRouterCache: { baseUrl: string; at: number; prices: Promise<Map<string, ModelPrice>> } | null = null

/** OpenRouter publishes US dollars per token as strings; negative means "varies". */
function toPrice(pricing: { prompt: string; completion: string }): ModelPrice | null {
  const input = Number(pricing.prompt)
  const output = Number(pricing.completion)
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null
  return { inputPerMTok: input * 1_000_000, outputPerMTok: output * 1_000_000, source: "openrouter" }
}

async function fetchOpenRouterPrices(baseUrl: string, apiKey: string): Promise<Map<string, ModelPrice>> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(OPENROUTER_PRICE_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`)
  const parsed = openRouterModelsSchema.safeParse((await res.json()) as unknown)
  if (!parsed.success) throw new Error("Unexpected OpenRouter model list")
  const prices = new Map<string, ModelPrice>()
  for (const model of parsed.data.data) {
    const price = model.pricing ? toPrice(model.pricing) : null
    if (price) prices.set(model.id, price)
  }
  return prices
}

export async function openRouterPrice(baseUrl: string, apiKey: string, model: string): Promise<ModelPrice | null> {
  const now = Date.now()
  if (!openRouterCache || openRouterCache.baseUrl !== baseUrl || now - openRouterCache.at > OPENROUTER_PRICE_TTL_MS) {
    const prices = fetchOpenRouterPrices(baseUrl, apiKey)
    openRouterCache = { baseUrl, at: now, prices }
    // A failed fetch is not cached, so the next reply tries again.
    prices.catch(() => {
      if (openRouterCache?.prices === prices) openRouterCache = null
    })
  }
  try {
    return (await openRouterCache.prices).get(model) ?? null
  } catch {
    return null
  }
}

/** The price for a chat model, or `null` when unknown. Never throws. */
export async function modelPrice(
  provider: ProviderId,
  model: string,
  credentials: LLMCredentials
): Promise<ModelPrice | null> {
  if (provider === "custom") {
    if (!credentials.baseUrl || !isOpenRouterBaseUrl(credentials.baseUrl)) return null
    return openRouterPrice(credentials.baseUrl, credentials.apiKey, model)
  }
  return listPrice(provider, model)
}

export function resetPriceCache(): void {
  openRouterCache = null
}
