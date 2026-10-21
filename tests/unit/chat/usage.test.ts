import { describe, expect, it } from "vitest"

import {
  addCall,
  callCost,
  EMPTY_SESSION_USAGE,
  formatTokens,
  formatUsd,
  usageDetail,
  usageLabel,
  type ModelPrice,
} from "@/lib/chat/usage"

const list: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15, source: "list" }
const live: ModelPrice = { inputPerMTok: 1, outputPerMTok: 2, source: "openrouter" }

describe("session usage", () => {
  it("adds calls and costs per million tokens", () => {
    expect(callCost({ inputTokens: 1_000_000, outputTokens: 100_000 }, list)).toBeCloseTo(4.5)
    const one = addCall(EMPTY_SESSION_USAGE, { inputTokens: 10_000, outputTokens: 2_000 }, live)
    const two = addCall(one, { inputTokens: 5_000, outputTokens: 500 }, live)
    expect(two).toEqual({
      inputTokens: 15_000,
      outputTokens: 2_500,
      calls: 2,
      pricedCalls: 2,
      costUsd: expect.closeTo(0.02, 6),
      estimated: false,
    })
    expect(addCall(two, { inputTokens: 1, outputTokens: 1 }, list).estimated).toBe(true)
    expect(addCall(two, { inputTokens: 1, outputTokens: 1 }, null)).toMatchObject({ calls: 3, pricedCalls: 2 })
  })

  it("formats tokens and dollars", () => {
    expect(formatTokens(950)).toBe("950")
    expect(formatTokens(12_400)).toBe("12k")
    expect(formatTokens(1_530)).toBe("1.5k")
    expect(formatTokens(2_300_000)).toBe("2.3M")
    expect(formatUsd(0)).toBe("$0.00")
    expect(formatUsd(0.004)).toBe("<$0.01")
    expect(formatUsd(0.042)).toBe("$0.04")
    expect(formatUsd(123.4)).toBe("$123")
  })

  it("labels known, estimated, partial, and unknown prices", () => {
    const priced = addCall(EMPTY_SESSION_USAGE, { inputTokens: 10_000, outputTokens: 5_000 }, live)
    expect(usageLabel(priced)).toBe("15k tokens · $0.02")
    const estimated = addCall(EMPTY_SESSION_USAGE, { inputTokens: 10_000, outputTokens: 5_000 }, list)
    expect(usageLabel(estimated)).toBe("15k tokens · ~$0.10")
    const tiny = addCall(EMPTY_SESSION_USAGE, { inputTokens: 100, outputTokens: 10 }, list)
    expect(usageLabel(tiny)).toBe("110 tokens · <$0.01")
    expect(usageLabel(addCall(priced, { inputTokens: 1, outputTokens: 1 }, null))).toContain("at least $0.02")
    const unknown = addCall(EMPTY_SESSION_USAGE, { inputTokens: 300, outputTokens: 20 }, null)
    expect(usageLabel(unknown)).toBe("320 tokens · price unknown")
  })

  it("explains the number in the tooltip", () => {
    const unknown = addCall(EMPTY_SESSION_USAGE, { inputTokens: 300, outputTokens: 20 }, null)
    expect(usageDetail(unknown).join(" ")).toContain("only tokens are counted")
    const partial = addCall(addCall(EMPTY_SESSION_USAGE, { inputTokens: 1, outputTokens: 1 }, list), { inputTokens: 1, outputTokens: 1 }, null)
    const text = usageDetail(partial).join(" ")
    expect(text).toContain("in 2 model calls")
    expect(text).toContain("1 call has no known price")
    expect(text).toContain("estimate")
    expect(text).toContain("Not counted: Jev")
    expect(usageDetail(addCall(EMPTY_SESSION_USAGE, { inputTokens: 1, outputTokens: 1 }, live)).join(" ")).toContain("OpenRouter")
  })
})
