import { describe, expect, it } from "vitest"

import { checkConceptStandards, linkedConceptIds } from "@/lib/knowledge/checks"
import { hasErrors } from "@/lib/standards/checks"

describe("checkConceptStandards", () => {
  it("requires a type, kebab-case segments, and a real stale_after", () => {
    const issues = checkConceptStandards({
      id: "Metrics/Revenue",
      type: " ",
      staleAfter: "tomorrow",
      body: "See [missing](/missing.md).",
      knownIds: [],
    })
    expect(issues.map((issue) => issue.message)).toEqual([
      "type is required",
      expect.stringContaining("kebab-case"),
      "stale_after must be an ISO 8601 datetime",
      'Link to "missing" does not resolve',
    ])
    expect(hasErrors(issues)).toBe(true)
    expect(issues.find((issue) => issue.message.includes("missing"))?.severity).toBe("warning")
  })

  it("accepts a valid concept and resolves relative links", () => {
    const issues = checkConceptStandards({
      id: "metrics/revenue",
      type: "Metric",
      staleAfter: "2026-09-23T00:00:00Z",
      body: "See [margin](./margin.md) and [self](/metrics/revenue.md).",
      knownIds: ["metrics/margin"],
    })
    expect(issues).toEqual([])
    expect(linkedConceptIds("metrics/revenue", "See [web](https://example.com) and [more](more/).")).toEqual([])
  })
})
