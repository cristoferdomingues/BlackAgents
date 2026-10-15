import path from "node:path"
import { describe, expect, it } from "vitest"

import { scaffoldWorkspace } from "@/lib/fs-service"
import { inspectBundle } from "@/lib/knowledge/bundle"
import { listConcepts } from "@/lib/knowledge/store"
import { OKF_VERSION } from "@/lib/knowledge/schema"
import { makeTempEnv } from "../../helpers/workspace"

describe("crypto starter knowledge", () => {
  it("seeds an OKF 0.2 bundle that parses, and only on the crypto template", async () => {
    const env = await makeTempEnv()
    try {
      const cryptoRoot = path.join(env.workspace, "crypto-ws")
      await scaffoldWorkspace(cryptoRoot, "crypto")
      const concepts = await listConcepts(cryptoRoot)
      expect(concepts.map((concept) => concept.id)).toEqual([
        "crypto/bitcoin",
        "crypto/ethereum",
        "crypto/portfolio-metrics",
        "crypto/risk-thresholds",
      ])
      for (const concept of concepts) {
        expect(concept.frontmatter.type.trim().length).toBeGreaterThan(0)
        expect(concept.frontmatter.generated?.by).toBe("process:workspace-template")
        expect(concept.frontmatter.verified).toBeUndefined()
        expect(concept.warnings).toEqual([])
      }

      const report = await inspectBundle(path.join(cryptoRoot, ".black-agents", "knowledge"))
      expect(report.version).toBe(OKF_VERSION)
      expect(report.orphans).toEqual([])
      expect(report.missing).toEqual([])

      const blankRoot = path.join(env.workspace, "blank-ws")
      await scaffoldWorkspace(blankRoot, "blank")
      expect(await listConcepts(blankRoot)).toEqual([])
    } finally {
      await env.cleanup()
    }
  })
})
