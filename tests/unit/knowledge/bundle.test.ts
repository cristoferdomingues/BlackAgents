import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { inspectBundle, readBundleConcept, readIndexLevel, resolveIndexHref } from "@/lib/knowledge/bundle"
import { OkfVersionError } from "@/lib/knowledge/schema"
import { seedArtifact } from "../../helpers/workspace"

const bundles: string[] = []

async function bundle(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "okf-bundle-"))
  bundles.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(bundles.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("resolveIndexHref", () => {
  it("resolves concept files, directories and root-absolute links", () => {
    expect(resolveIndexHref("", "orders.md")).toEqual({ kind: "concept", target: "orders" })
    expect(resolveIndexHref("tables", "orders.md")).toEqual({ kind: "concept", target: "tables/orders" })
    expect(resolveIndexHref("", "/tables/customers.md")).toEqual({ kind: "concept", target: "tables/customers" })
    expect(resolveIndexHref("", "metrics/")).toEqual({ kind: "directory", target: "metrics" })
    expect(resolveIndexHref("", "https://example.com")).toEqual({ kind: "external", target: "https://example.com" })
  })

  it("drops links that leave the bundle", () => {
    expect(resolveIndexHref("tables", "../../secret.md")).toBeNull()
  })
})

describe("inspectBundle", () => {
  it("walks index.md one level at a time and finds orphans and missing links", async () => {
    const root = await bundle()
    await seedArtifact(
      root,
      "index.md",
      [
        "---",
        'okf_version: "0.2"',
        "---",
        "# Metrics",
        "* [Revenue](metrics/revenue.md) - Recognized revenue.",
        "* [More metrics](metrics/) - The rest.",
        "* [Missing](metrics/missing.md) - Not written yet.",
      ].join("\n")
    )
    await seedArtifact(root, "metrics/revenue.md", "---\ntype: Metric\ntitle: Revenue\n---\n\n# Definition\n\nRevenue.\n")
    await seedArtifact(root, "metrics/index.md", "# Metrics\n\n* [Margin](margin.md) - Gross margin.\n")
    await seedArtifact(root, "metrics/margin.md", "---\ntype: Metric\ntitle: Margin\n---\n\nMargin.\n")
    await seedArtifact(root, "notes/orphan.md", "---\ntype: Reference\ntitle: Orphan\n---\n\nUnlinked.\n")

    const rootLevel = await readIndexLevel(root)
    expect(rootLevel.version).toBe("0.2")
    expect(rootLevel.sections[0]?.entries.map((entry) => entry.target)).toEqual([
      "metrics/revenue",
      "metrics",
      "metrics/missing",
    ])

    const report = await inspectBundle(root)
    expect(report.levels.map((level) => level.dir)).toEqual(["", "metrics"])
    expect(report.conceptIds).toEqual(["metrics/margin", "metrics/revenue", "notes/orphan"])
    expect(report.orphans).toEqual(["notes/orphan"])
    expect(report.missing).toEqual([{ from: "", href: "metrics/missing.md", target: "metrics/missing" }])

    const concept = await readBundleConcept(root, "metrics/revenue")
    expect(concept.ok && concept.concept.body).toContain("Revenue.")
  })

  it("refuses a bundle that declares a version other than 0.2", async () => {
    const root = await bundle()
    await seedArtifact(root, "index.md", "---\nokf_version: \"0.1\"\n---\n# Docs\n* [Note](note.md) - A note.\n")
    await seedArtifact(root, "note.md", "---\ntype: Reference\n---\n\nHi.\n")
    await expect(inspectBundle(root)).rejects.toBeInstanceOf(OkfVersionError)
    await expect(inspectBundle(root)).rejects.toThrow(/only reads OKF 0\.2/)
  })

  it("allows a bundle with no version and reports every file as unlisted", async () => {
    const root = await bundle()
    await seedArtifact(root, "note.md", "---\ntype: Reference\ntitle: Note\n---\n\nHi.\n")
    const report = await inspectBundle(root)
    expect(report.version).toBeUndefined()
    expect(report.orphans).toEqual(["note"])
  })

  it("reads a v0.1 timestamp inside an accepted bundle as a warning", async () => {
    const root = await bundle()
    await seedArtifact(root, "note.md", "---\ntype: Metric\ntimestamp: 2026-05-28T22:53:05Z\n---\n\nHi.\n")
    const concept = await readBundleConcept(root, "note")
    if (!concept.ok) throw new Error(concept.message)
    expect(concept.concept.warnings.map((warning) => warning.code)).toEqual(["v0.1-timestamp"])
    expect(concept.concept.frontmatter.generated?.at).toBe("2026-05-28T22:53:05Z")
  })
})
