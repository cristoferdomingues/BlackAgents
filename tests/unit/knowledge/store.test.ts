import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { readConcept, writeConcept, listConcepts, conceptRelPath, KnowledgePathError } from "@/lib/knowledge/store"
import type { OkfConceptFrontmatter } from "@/lib/knowledge/schema"
import { makeTempEnv, seedArtifact, type TempEnv } from "../../helpers/workspace"
import { readFile } from "node:fs/promises"
import path from "node:path"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const frontmatter: OkfConceptFrontmatter = {
  type: "Metric",
  title: "Portfolio metrics",
  description: "How a portfolio is measured.",
  extra: { owner: "finance" },
}

describe("knowledge store", () => {
  it("writes only inside .black-agents/knowledge and reads the concept back", async () => {
    const saved = await writeConcept(env.workspace, {
      id: "crypto/portfolio-metrics",
      frontmatter,
      body: "# Definition\n\nValue over time.\n",
    })
    expect(saved.frontmatter).toMatchObject({ type: "Metric", title: "Portfolio metrics" })
    expect(saved.frontmatter.extra).toEqual({ owner: "finance" })
    expect(conceptRelPath("crypto/portfolio-metrics")).toBe(".black-agents/knowledge/crypto/portfolio-metrics.md")

    const onDisk = await readFile(path.join(env.workspace, ".black-agents/knowledge/crypto/portfolio-metrics.md"), "utf8")
    expect(onDisk).toContain("type: Metric")
    expect(onDisk).toContain("owner: finance")
    expect(await readConcept(env.workspace, "crypto/portfolio-metrics")).toMatchObject({ id: "crypto/portfolio-metrics" })
    expect((await listConcepts(env.workspace)).map((concept) => concept.id)).toEqual(["crypto/portfolio-metrics"])
  })

  it("refuses an id that escapes the knowledge folder", async () => {
    await expect(writeConcept(env.workspace, { id: "../secrets", frontmatter, body: "no" })).rejects.toBeInstanceOf(
      KnowledgePathError
    )
    expect(() => conceptRelPath("Crypto/Bad")).toThrow(/kebab-case/)
  })

  it("returns null for a missing concept and skips reserved files", async () => {
    expect(await readConcept(env.workspace, "crypto/missing")).toBeNull()
    await seedArtifact(env.workspace, ".black-agents/knowledge/index.md", "# Index\n")
    await seedArtifact(env.workspace, ".black-agents/knowledge/log.md", "# Log\n")
    expect(await listConcepts(env.workspace)).toEqual([])
  })
})
