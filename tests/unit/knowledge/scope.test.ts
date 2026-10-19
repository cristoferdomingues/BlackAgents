import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  inspectKnowledgeStore,
  listConcepts,
  readConcept,
  writeConcept,
} from "@/lib/knowledge/store"
import type { OkfConceptFrontmatter } from "@/lib/knowledge/schema"
import { makeTempEnv, seedProject, type TempEnv } from "../../helpers/workspace"

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
  extra: {},
}

async function seedConcept(): Promise<void> {
  await writeConcept(env.workspace, {
    id: "crypto/portfolio-metrics",
    frontmatter,
    body: "# Definition\n\nValue over time.\n",
  })
}

describe("knowledge gating in a scope", () => {
  it("whitelisted projects read the workspace registry", async () => {
    await seedConcept()
    await seedProject(env.workspace, "web", { inherits: ["knowledge"] })
    const concepts = await listConcepts(env.workspace, "web")
    expect(concepts.map((c) => c.id)).toEqual(["crypto/portfolio-metrics"])
    const one = await readConcept(env.workspace, "crypto/portfolio-metrics", "web")
    expect(one?.frontmatter.title).toBe("Portfolio metrics")
  })

  it("without the token the registry resolves to nothing (fail closed)", async () => {
    await seedConcept()
    await seedProject(env.workspace, "web", { inherits: ["rules"] })
    expect(await listConcepts(env.workspace, "web")).toEqual([])
    expect(await readConcept(env.workspace, "crypto/portfolio-metrics", "web")).toBeNull()
    const inspection = await inspectKnowledgeStore(env.workspace, "web")
    expect(inspection).toEqual({ concepts: [], issues: [] })
  })

  it("a project that does not load sees nothing", async () => {
    await seedConcept()
    expect(await listConcepts(env.workspace, "ghost")).toEqual([])
    expect(await readConcept(env.workspace, "crypto/portfolio-metrics", "ghost")).toBeNull()
  })

  it("an unknown token invalidates the whole whitelist", async () => {
    await seedConcept()
    await seedProject(env.workspace, "web", { inherits: ["knowledge", "files"] })
    expect(await listConcepts(env.workspace, "web")).toEqual([])
  })

  it("workspace mode is unchanged", async () => {
    await seedConcept()
    expect((await listConcepts(env.workspace)).map((c) => c.id)).toEqual([
      "crypto/portfolio-metrics",
    ])
    expect(await readConcept(env.workspace, "crypto/portfolio-metrics")).not.toBeNull()
  })

  it("issues are still reported to whitelisted projects", async () => {
    await seedConcept()
    // An invalid concept file must surface, not disappear — for whitelisted scopes.
    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(`${env.workspace}/.black-agents/knowledge/Bad_Folder`, { recursive: true })
    await writeFile(
      `${env.workspace}/.black-agents/knowledge/Bad_Folder/x.md`,
      "---\ntype: Metric\n---\n\nbody\n",
      "utf8"
    )
    await seedProject(env.workspace, "web", { inherits: ["knowledge"] })
    const inspection = await inspectKnowledgeStore(env.workspace, "web")
    expect(inspection.issues.length).toBeGreaterThan(0)
  })
})
