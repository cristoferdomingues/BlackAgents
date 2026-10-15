import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { decideProposal, ProposalError, proposeConceptFromMemory } from "@/lib/brain/learn"
import { readConcept } from "@/lib/knowledge/store"
import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("memory to concept", () => {
  it("queues generated only, then approval writes verified", async () => {
    const proposal = await proposeConceptFromMemory(env.workspace, {
      id: "metrics/revenue",
      type: "Metric",
      title: "Revenue",
      content: "Recognized revenue.\n\nSee [missing](missing.md).",
    })
    expect(proposal.kind).toBe("new_concept")
    expect(proposal.concept?.generated?.by).toBe("process:memory-promotion")
    expect(proposal.concept?.verified).toBeUndefined()
    expect(await readConcept(env.workspace, "metrics/revenue")).toBeNull()

    const approved = await decideProposal(env.workspace, proposal.id, { action: "approve" })
    expect(approved.concept?.verified?.[0]?.by).toBe("human:local")
    expect(approved.concept?.generated?.by).toBe("process:memory-promotion")
    const onDisk = await readFile(
      path.join(env.workspace, ".black-agents/knowledge/metrics/revenue.md"),
      "utf8"
    )
    expect(onDisk).toContain("human:local")
    expect(onDisk).toContain("process:memory-promotion")
    expect(onDisk).not.toContain("verified:\nverified:")

    const update = await proposeConceptFromMemory(env.workspace, {
      id: "metrics/revenue",
      type: "Metric",
      content: "Revenue is recognized when booked.",
    })
    expect(update.kind).toBe("update_concept")
    expect(update.concept?.verified).toBeUndefined()
    expect(update.concept?.generated?.by).toBe("process:memory-promotion")
    await decideProposal(env.workspace, update.id, { action: "approve" })
    const saved = await readConcept(env.workspace, "metrics/revenue")
    expect(saved?.body).toContain("when booked")
    expect(saved?.frontmatter.generated?.by).toBe("process:memory-promotion")
    expect(saved?.frontmatter.verified).toHaveLength(2)
  })

  it("refuses a bad id and does not write a file", async () => {
    await expect(
      proposeConceptFromMemory(env.workspace, { id: "../secret", type: "Metric", content: "no" })
    ).rejects.toBeInstanceOf(ProposalError)
    await expect(readFile(path.join(env.workspace, ".black-agents/knowledge"), "utf8")).rejects.toThrow()
  })
})
