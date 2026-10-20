/**
 * How much text a request to a model may carry. Token windows are approximate
 * and matched by model-id family; the char budget keeps headroom for the reply
 * and for provider formatting (see the `context-headroom` rule).
 */

export const CHARS_PER_TOKEN = 4
/** Share of the window left unused, so quality and cost stay sane near the limit. */
export const CONTEXT_HEADROOM = 0.15
/** Tokens kept free for the model's reply. */
export const OUTPUT_RESERVE_TOKENS = 8_000
/** Used for an unknown model (often a Custom provider). Conservative on purpose. */
export const DEFAULT_WINDOW_TOKENS = 64_000

const WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^claude-/, 200_000],
  [/^gpt-4\.1/, 1_000_000],
  [/^gpt-5/, 400_000],
  [/^gpt-4o/, 128_000],
  [/^gpt-4-turbo/, 128_000],
  [/^gpt-4(?!\.|o|-turbo)/, 8_000],
  [/^gpt-3\.5/, 16_000],
  [/^o\d/, 200_000],
  [/^gemini-/, 1_000_000],
  [/^(mistral|mixtral)/, 32_000],
  [/^(llama|meta-llama)/, 128_000],
  [/^deepseek/, 64_000],
  [/^grok/, 128_000],
]

/** Approximate token window. OpenRouter ids like `anthropic/claude-…` match by their last part. */
export function contextWindowTokens(model: string): number {
  const id = model.trim().toLowerCase().split("/").pop() ?? ""
  for (const [pattern, tokens] of WINDOWS) {
    if (pattern.test(id)) return tokens
  }
  return DEFAULT_WINDOW_TOKENS
}

/** Max request size in chars for this model, after headroom and the reply reserve. */
export function contextCharsFor(model: string): number {
  const tokens = contextWindowTokens(model)
  const usable = Math.max(tokens * (1 - CONTEXT_HEADROOM) - OUTPUT_RESERVE_TOKENS, tokens * 0.5)
  return Math.floor(usable * CHARS_PER_TOKEN)
}
