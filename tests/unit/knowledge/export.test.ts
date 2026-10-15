import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

import { fileStatus } from "@/lib/export/adapter"
import { inspectBundle } from "@/lib/knowledge/bundle"
import { OKF_BUNDLE_DIR, OKF_EXPORT_LABEL } from "@/lib/knowledge/explain"
import { buildOkfBundle } from "@/lib/knowledge/export"
import type { OkfConcept } from "@/lib/knowledge/parse"
import { makeTempEnv } from "../../helpers/workspace"

function concept(partial: Pick<OkfConcept, "id"> & Partial<OkfConcept>): OkfConcept {
  return {
    id: partial.id,
    body: partial.body ?? "Body.\n",
    warnings: [],
    frontmatter: {
      type: "Metric",
      extra: {},
      ...partial.frontmatter,
    },
  }
}

describe("OKF bundle writer", () => {
  it("builds v0.2 concept files, indexes, and a log from concept history", async () => {
    const files = buildOkfBundle([
      concept({
        id: "metrics/revenue",
        body: "# Definition\n\nRevenue.\n",
        frontmatter: {
          type: "Metric",
          title: "Revenue",
          description: "Recognized revenue.",
          generated: { by: "process:import", at: "2026-06-20T22:53:05Z" },
          verified: [{ by: "human:local", at: "2026-06-25T09:00:00Z" }],
          extra: { owner: "finance" },
        },
      }),
      concept({
        id: "metrics/margin",
        frontmatter: { type: "Metric", title: "Margin", description: "Gross margin.", extra: {} },
      }),
      concept({
        id: "note",
        frontmatter: {
          type: "Reference",
          title: "Note",
          generated: { by: "process:import", at: "2026-05-01T00:00:00Z" },
          extra: {},
        },
      }),
    ])

    const byPath = new Map(files.map((file) => [file.path, file.content]))
    expect(OKF_EXPORT_LABEL).toBe("OKF Bundle")
    expect([...byPath.keys()].every((filePath) => filePath.startsWith(`${OKF_BUNDLE_DIR}/`))).toBe(true)

    const revenue = byPath.get("okf/metrics/revenue.md") ?? ""
    expect(revenue).toContain("type: Metric")
    expect(revenue).toContain("owner: finance")
    expect(revenue).toContain("human:local")
    expect(revenue).toContain("Revenue.")
    expect(revenue.match(/verified:/g)).toHaveLength(1)

    const rootIndex = byPath.get("okf/index.md") ?? ""
    expect(rootIndex).toContain('okf_version: "0.2"')
    expect(rootIndex).toContain("* [Note](note.md)")
    expect(rootIndex).toContain("* [Metrics](metrics/) - 2 concepts.")
    expect(rootIndex).not.toContain("revenue.md")

    const nested = byPath.get("okf/metrics/index.md") ?? ""
    expect(nested.startsWith("# Metrics")).toBe(true)
    expect(nested).toContain("* [Revenue](revenue.md) - Recognized revenue.")
    expect(nested).toContain("* [Margin](margin.md) - Gross margin.")

    const log = byPath.get("okf/log.md") ?? ""
    const review = log.indexOf("## 2026-06-25")
    const created = log.indexOf("## 2026-06-20")
    const older = log.indexOf("## 2026-05-01")
    expect(review).toBeGreaterThan(-1)
    expect(review).toBeLessThan(created)
    expect(created).toBeLessThan(older)
    expect(log).toContain("**Creation**: Added [Revenue](/metrics/revenue.md) by process:import.")
    expect(log).toContain("**Update**: Reviewed [Revenue](/metrics/revenue.md) by human:local.")
    expect(log).not.toContain("Margin")

    const env = await makeTempEnv()
    try {
      for (const file of files) {
        const abs = path.join(env.workspace, file.path)
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, file.content, "utf8")
      }
      const report = await inspectBundle(path.join(env.workspace, "okf"))
      expect(report.version).toBe("0.2")
      expect(report.orphans).toEqual([])
      expect(report.missing).toEqual([])
      expect(fileStatus(revenue, revenue)).toBe("unchanged")
      expect(fileStatus(null, revenue)).toBe("create")
      expect(fileStatus("old", revenue)).toBe("overwrite")
    } finally {
      await env.cleanup()
    }
  })

  it("still emits a versioned index and an empty log when there are no concepts", () => {
    const files = buildOkfBundle([])
    expect(files.map((file) => file.path)).toEqual(["okf/index.md", "okf/log.md"])
    expect(files[0]?.content).toContain('okf_version: "0.2"')
    expect(files[1]?.content).toBe("# Directory Update Log\n")
  })
})
