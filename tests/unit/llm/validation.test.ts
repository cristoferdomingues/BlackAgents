import { describe, it, expect } from "vitest"

import { extractValidation } from "@/lib/llm/validation"

function fenced(obj: unknown): string {
  return "Review:\n```validation\n" + JSON.stringify(obj) + "\n```"
}

describe("extractValidation", () => {
  it("parses a summary + findings block", () => {
    const result = extractValidation(
      fenced({
        summary: "Mostly good.",
        findings: [
          { severity: "warning", section: "Workflow", message: "Add error handling.", suggestion: "Add a section." },
          { severity: "info", message: "Consider a link." },
        ],
      })
    )
    expect(result?.summary).toBe("Mostly good.")
    expect(result?.findings).toHaveLength(2)
    expect(result?.findings[0]).toMatchObject({ severity: "warning", section: "Workflow" })
  })

  it("defaults findings to an empty array when omitted", () => {
    const result = extractValidation(fenced({ summary: "All good." }))
    expect(result).toEqual({ summary: "All good.", findings: [] })
  })

  it("returns null when there is no validation fence", () => {
    expect(extractValidation("no block here")).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(extractValidation("```validation\n{oops}\n```")).toBeNull()
  })

  it("returns null when a finding has an invalid severity", () => {
    expect(
      extractValidation(fenced({ findings: [{ severity: "critical", message: "x" }] }))
    ).toBeNull()
  })

  it("returns null when a finding has an empty message", () => {
    expect(
      extractValidation(fenced({ findings: [{ severity: "error", message: "" }] }))
    ).toBeNull()
  })
})
