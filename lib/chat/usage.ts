import { z } from "zod"

/**
 * Token use and cost for one chat session (isomorphic). The server sends the
 * model price once per reply; the browser adds each model call to the total.
 */

export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
})
export type TokenCounts = z.infer<typeof tokenUsageSchema>

/** US dollars per million tokens. */
export const modelPriceSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  /** `openrouter` — the live OpenRouter price. `list` — our table of list prices. */
  source: z.enum(["openrouter", "list"]),
})
export type ModelPrice = z.infer<typeof modelPriceSchema>

export const sessionUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Model calls with token counts. */
  calls: z.number().int().nonnegative(),
  /** Calls with a known price; `costUsd` covers only these. */
  pricedCalls: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  /** True once any priced call used our list prices (an estimate). */
  estimated: z.boolean().default(false),
})
export type SessionUsage = z.infer<typeof sessionUsageSchema>

export const EMPTY_SESSION_USAGE: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  calls: 0,
  pricedCalls: 0,
  costUsd: 0,
  estimated: false,
}

export function callCost(tokens: TokenCounts, price: ModelPrice): number {
  return (tokens.inputTokens * price.inputPerMTok + tokens.outputTokens * price.outputPerMTok) / 1_000_000
}

export function addCall(usage: SessionUsage, tokens: TokenCounts, price: ModelPrice | null): SessionUsage {
  return {
    inputTokens: usage.inputTokens + tokens.inputTokens,
    outputTokens: usage.outputTokens + tokens.outputTokens,
    calls: usage.calls + 1,
    pricedCalls: usage.pricedCalls + (price ? 1 : 0),
    costUsd: usage.costUsd + (price ? callCost(tokens, price) : 0),
    estimated: usage.estimated || price?.source === "list",
  }
}

export function formatTokens(count: number): string {
  if (count < 1_000) return String(count)
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.01) return "<$0.01"
  if (amount < 100) return `$${amount.toFixed(2)}`
  return `$${Math.round(amount)}`
}

/** Short header text, e.g. "15.5k tokens · ~$0.04". */
export function usageLabel(usage: SessionUsage): string {
  const tokens = `${formatTokens(usage.inputTokens + usage.outputTokens)} tokens`
  if (usage.pricedCalls === 0) return `${tokens} · price unknown`
  const cost = formatUsd(usage.costUsd)
  if (usage.pricedCalls < usage.calls) return `${tokens} · at least ${cost}`
  const approx = usage.estimated && usage.costUsd >= 0.01 ? "~" : ""
  return `${tokens} · ${approx}${cost}`
}

export const USAGE_NOT_COUNTED =
  "Not counted: Jev, voice, video, and the summary of older messages."

/** Lines for the header tooltip. */
export function usageDetail(usage: SessionUsage): string[] {
  const lines = [
    `This chat: ${formatTokens(usage.inputTokens)} tokens in, ${formatTokens(usage.outputTokens)} out, in ${usage.calls} model ${usage.calls === 1 ? "call" : "calls"}.`,
  ]
  if (usage.pricedCalls === 0) {
    lines.push("No price is known for this model, so only tokens are counted.")
  } else {
    const unpriced = usage.calls - usage.pricedCalls
    if (unpriced > 0) {
      lines.push(`${unpriced} ${unpriced === 1 ? "call has" : "calls have"} no known price, so the real cost is higher.`)
    }
    lines.push(
      usage.estimated
        ? "The cost is an estimate from public list prices. Your provider bill is the real number."
        : "The cost uses the price from OpenRouter."
    )
  }
  lines.push(USAGE_NOT_COUNTED)
  return lines
}
