import { describe, expect, it } from "vitest"

import {
  assertOkfVersion,
  declaredVersion,
  isStale,
  normalizeFrontmatter,
  OkfVersionError,
  trustTier,
} from "@/lib/knowledge/schema"

const body = "# Definition\n\nRevenue.\n"

describe("normalizeFrontmatter", () => {
  it("reads a valid v0.2 concept and keeps unknown keys", () => {
    const result = normalizeFrontmatter(
      {
        type: "Metric",
        title: "Revenue",
        description: "Recognized revenue.",
        tags: ["finance"],
        status: "stable",
        generated: { by: "reference_agent/gemini-2.5-pro", at: "2026-06-20T22:53:05Z" },
        verified: { by: "human:ada", at: "2026-06-25T09:00:00Z" },
        stale_after: "2026-12-31T00:00:00Z",
        sources: [{ id: "handbook", resource: "https://wiki.example/handbook", usage_count: 3 }],
        owner: "finance",
      },
      body
    )
    expect(result).toMatchObject({ warnings: [] })
    if ("error" in result) return
    expect(result.frontmatter.verified).toEqual([{ by: "human:ada", at: "2026-06-25T09:00:00Z" }])
    expect(result.frontmatter.extra).toEqual({ owner: "finance" })
    expect(trustTier(result.frontmatter.verified)).toBe("human-reviewed")
    expect(isStale(result.frontmatter.stale_after, new Date("2026-12-31T00:00:00Z"))).toBe(true)
    expect(isStale(result.frontmatter.stale_after, new Date("2026-12-30T00:00:00Z"))).toBe(false)
  })

  it("accepts an Attested Computation with its runtime", () => {
    const result = normalizeFrontmatter(
      {
        type: "Attested Computation",
        runtime: "bigquery",
        parameters: [{ name: "year", type: "integer", required: true }],
        executor: { resource: "references/run.md", receipt: ["job_id"] },
      },
      "# Computation\n\nSELECT 1\n"
    )
    expect("error" in result).toBe(false)
  })

  it("rejects a concept with no type", () => {
    const missing = normalizeFrontmatter({ title: "Revenue" }, body)
    expect("error" in missing && missing.error).toMatch(/type/)
  })

  it("rejects an unknown status and a computation with no runtime", () => {
    expect(normalizeFrontmatter({ type: "Metric", status: "live" }, body)).toMatchObject({
      error: expect.stringContaining("status"),
    })
    expect(normalizeFrontmatter({ type: "Attested Computation" }, body)).toEqual({
      error: "runtime is required for Attested Computation",
    })
  })

  it("rejects a source with no resource", () => {
    const result = normalizeFrontmatter({ type: "Metric", sources: [{ title: "Handbook" }] }, body)
    expect(result).toMatchObject({ error: expect.stringContaining("resource") })
  })

  it("warns when a v0.1 timestamp is read as generated.at", () => {
    const result = normalizeFrontmatter({ type: "Metric", timestamp: "2026-05-28T22:53:05Z" }, body)
    if ("error" in result) throw new Error(result.error)
    expect(result.warnings.map((warning) => warning.code)).toEqual(["v0.1-timestamp"])
    expect(result.frontmatter.generated).toEqual({ by: "process:okf-v0.1", at: "2026-05-28T22:53:05Z" })
    expect(result.frontmatter.extra).not.toHaveProperty("timestamp")
  })

  it("warns when timestamp is present beside generated", () => {
    const result = normalizeFrontmatter(
      { type: "Metric", timestamp: "2026-05-28T22:53:05Z", generated: { by: "human:ada", at: "2026-06-01T00:00:00Z" } },
      body
    )
    if ("error" in result) throw new Error(result.error)
    expect(result.warnings[0]?.message).toContain("ignored")
    expect(result.frontmatter.generated?.by).toBe("human:ada")
  })

  it("rejects a timestamp that is not a datetime", () => {
    expect(normalizeFrontmatter({ type: "Metric", timestamp: "yesterday" }, body)).toEqual({
      error: 'v0.1 "timestamp" is not an ISO 8601 datetime',
    })
  })

  it("warns when a v0.1 Citations list is read as sources", () => {
    const cited = `${body}\n# Citations\n- https://wiki.example/a\n- [Handbook](https://wiki.example/b)\n\n# Other\n- ignored\n`
    const result = normalizeFrontmatter({ type: "Metric" }, cited)
    if ("error" in result) throw new Error(result.error)
    expect(result.warnings.map((warning) => warning.code)).toEqual(["v0.1-citations"])
    expect(result.frontmatter.sources).toEqual([
      { resource: "https://wiki.example/a" },
      { title: "Handbook", resource: "https://wiki.example/b" },
    ])
  })

  it("does not replace sources that are already declared", () => {
    const result = normalizeFrontmatter(
      { type: "Metric", sources: [{ resource: "https://wiki.example/real" }] },
      "# Citations\n- https://wiki.example/old\n"
    )
    if ("error" in result) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    expect(result.frontmatter.sources).toEqual([{ resource: "https://wiki.example/real" }])
  })

  it("derives trust tiers", () => {
    expect(trustTier(undefined)).toBe("unverified")
    expect(trustTier([{ by: "process:nightly", at: "2026-06-01T00:00:00Z" }])).toBe("machine-confirmed")
  })
})

describe("assertOkfVersion", () => {
  it("accepts 0.2 and a missing version", () => {
    expect(() => assertOkfVersion("0.2")).not.toThrow()
    expect(() => assertOkfVersion(undefined)).not.toThrow()
    expect(declaredVersion(0.2)).toBe("0.2")
  })

  it("refuses every other version with a clear message", () => {
    expect(() => assertOkfVersion("0.1")).toThrow(OkfVersionError)
    expect(() => assertOkfVersion("0.1")).toThrow(/only reads OKF 0\.2/)
    expect(() => assertOkfVersion("1.0")).toThrow(/OKF 1\.0/)
  })
})
