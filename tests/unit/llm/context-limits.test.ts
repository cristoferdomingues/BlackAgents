import { describe, expect, it } from "vitest"

import {
  CHARS_PER_TOKEN,
  contextCharsFor,
  contextWindowTokens,
  DEFAULT_WINDOW_TOKENS,
} from "@/lib/llm/context-limits"

describe("contextWindowTokens", () => {
  it("knows the common model families", () => {
    expect(contextWindowTokens("claude-sonnet-4-20250514")).toBe(200_000)
    expect(contextWindowTokens("gpt-4o-mini")).toBe(128_000)
    expect(contextWindowTokens("gpt-4.1-mini")).toBe(1_000_000)
    expect(contextWindowTokens("o4-mini")).toBe(200_000)
    expect(contextWindowTokens("gpt-4")).toBe(8_000)
  })

  it("matches an OpenRouter id by its last part, and is case-insensitive", () => {
    expect(contextWindowTokens("anthropic/Claude-3-5-haiku-latest")).toBe(200_000)
    expect(contextWindowTokens("google/gemini-2.5-flash")).toBe(1_000_000)
  })

  it("falls back to a conservative window for unknown models", () => {
    expect(contextWindowTokens("my-local-model")).toBe(DEFAULT_WINDOW_TOKENS)
    expect(contextWindowTokens("")).toBe(DEFAULT_WINDOW_TOKENS)
  })
})

describe("contextCharsFor", () => {
  it("keeps headroom and a reply reserve below the full window", () => {
    const chars = contextCharsFor("claude-sonnet-4-20250514")
    expect(chars).toBeLessThan(200_000 * CHARS_PER_TOKEN * 0.86)
    expect(chars).toBeGreaterThan(200_000 * CHARS_PER_TOKEN * 0.7)
  })

  it("never drops below half the window for a tiny model", () => {
    expect(contextCharsFor("gpt-4")).toBe(8_000 * 0.5 * CHARS_PER_TOKEN)
  })

  it("gives a bigger model a bigger budget", () => {
    expect(contextCharsFor("gpt-4.1")).toBeGreaterThan(contextCharsFor("gpt-4o"))
  })
})
