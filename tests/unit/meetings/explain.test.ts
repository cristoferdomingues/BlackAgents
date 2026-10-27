import { describe, expect, it } from "vitest"

import { BUILD_EFFECT, LIMITS_LINE, SAVE_EFFECT, TASK_EFFECT, callAppLine, notesLanguageLine } from "@/lib/meetings/explain"

describe("meeting copy", () => {
  it("says what save and build do, and where the limit is", () => {
    expect(SAVE_EFFECT).toContain("Brain")
    expect(SAVE_EFFECT).toContain("transcript stays")
    expect(BUILD_EFFECT).toContain("Nothing is saved")
    expect(LIMITS_LINE).toContain("120 minutes")
    expect(notesLanguageLine("português")).toBe("Notes are in português, the language used most in the call.")
    expect(callAppLine("Zoom")).toContain("Zoom")
    expect(TASK_EFFECT).toContain("Nothing is saved")
  })
})
