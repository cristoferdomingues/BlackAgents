import { describe, expect, it } from "vitest"

import { BUILD_EFFECT, LIMITS_LINE, SAVE_EFFECT, notesLanguageLine } from "@/lib/meetings/explain"

describe("meeting copy", () => {
  it("says what save and build do, and where the limit is", () => {
    expect(SAVE_EFFECT).toContain("Brain")
    expect(BUILD_EFFECT).toContain("Nothing is saved")
    expect(LIMITS_LINE).toContain("120 minutes")
    expect(notesLanguageLine("português")).toBe("Notes are in português, the language used most in the call.")
  })
})
