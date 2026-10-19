import { describe, expect, it } from "vitest"

import { parseReviewVerdict, reviewReasons } from "@/lib/workflows/review"

describe("parseReviewVerdict", () => {
  it("reads approve and reject lines in common shapes", () => {
    expect(parseReviewVerdict("Looks good.\nVERDICT: approve")).toBe("approve")
    expect(parseReviewVerdict("Bad tests.\nverdict: Rejected")).toBe("reject")
    expect(parseReviewVerdict("**Verdict:** reject")).toBe("reject")
    expect(parseReviewVerdict("  VERDICT : APPROVED  ")).toBe("approve")
    expect(parseReviewVerdict("Done.\nVERDICT: PASS")).toBe("approve")
    expect(parseReviewVerdict("Done.\nVERDICT: FAIL")).toBe("reject")
  })

  it("uses the last verdict line", () => {
    expect(parseReviewVerdict("VERDICT: approve\nOn second look, no.\nVERDICT: reject")).toBe("reject")
  })

  it("returns null without a verdict line", () => {
    expect(parseReviewVerdict("")).toBeNull()
    expect(parseReviewVerdict("I would reject this.")).toBeNull()
    expect(parseReviewVerdict("The verdict: maybe later")).toBeNull()
  })
})

describe("reviewReasons", () => {
  it("drops the verdict line and keeps the reasons", () => {
    expect(reviewReasons("- No tests\n- Uses any\n\nVERDICT: reject\n")).toBe("- No tests\n- Uses any")
  })
})
