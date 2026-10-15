import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { POST } from "@/app/api/knowledge/import/route"
import { decideProposal } from "@/lib/brain/learn"
import { listProposals } from "@/lib/brain/store"
import { makeTempEnv, jsonRequest, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

function call(body: unknown): Promise<Response> {
  return POST(jsonRequest("http://t/api/knowledge/import", "POST", body))
}

async function seedBundle(version = "0.2"): Promise<string> {
  const root = path.join(env.workspace, "bundle")
  await seedArtifact(
    env.workspace,
    "bundle/index.md",
    `---\nokf_version: "${version}"\n---\n# Metrics\n* [Revenue](metrics/revenue.md) - Recognized revenue.\n* [Missing](missing.md) - Gone.\n`
  )
  await seedArtifact(
    env.workspace,
    "bundle/metrics/revenue.md",
    "---\ntype: Metric\ntitle: Revenue\ndescription: Recognized revenue.\n---\n\n# Definition\n\nRevenue.\n"
  )
  return root
}

describe("POST /api/knowledge/import", () => {
  it("previews a bundle and writes nothing", async () => {
    const root = await seedBundle()
    const res = await call({ action: "preview", path: root })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.version).toBe("0.2")
    expect(json.data.levels[0].sections[0].entries[0]).toMatchObject({
      title: "Revenue",
      kind: "concept",
      target: "metrics/revenue",
    })
    expect(json.data.missing).toEqual([{ href: "missing.md", target: "missing" }])
    await expect(readdir(path.join(env.workspace, ".black-agents", "knowledge"))).rejects.toThrow()
    expect(await listProposals(env.workspace)).toEqual([])
  })

  it("refuses a bundle on another OKF version", async () => {
    const root = await seedBundle("0.1")
    const res = await call({ action: "preview", path: root })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/only reads OKF 0\.2/)
  })

  it("rejects a missing folder, a file, a bad body, and a broken concept", async () => {
    expect((await call({ action: "preview", path: path.join(env.workspace, "nope") })).status).toBe(404)
    await seedArtifact(env.workspace, "notes.txt", "hello")
    expect((await call({ action: "preview", path: path.join(env.workspace, "notes.txt") })).status).toBe(400)
    expect((await call({ action: "preview" })).status).toBe(400)

    const root = await seedBundle()
    await seedArtifact(env.workspace, "bundle/metrics/broken.md", "---\ntitle: No type\n---\n\nHi.\n")
    const queued = await call({ action: "queue", path: root, id: "metrics/broken" })
    expect(queued.status).toBe(400)
    expect((await queued.json()).error).toMatch(/type/)
  })

  it("queues one concept and saves the file only when the inbox approves it", async () => {
    const root = await seedBundle()
    const res = await call({ action: "queue", path: root, id: "metrics/revenue" })
    expect(res.status).toBe(201)
    await expect(readdir(path.join(env.workspace, ".black-agents", "knowledge"))).rejects.toThrow()

    const [proposal] = await listProposals(env.workspace)
    expect(proposal).toMatchObject({ kind: "new_concept", status: "pending", target: { type: "concept", name: "metrics/revenue" } })

    const applied = await decideProposal(env.workspace, proposal.id, { action: "approve" })
    expect(applied.status).toBe("approved")
    const file = await readFile(
      path.join(env.workspace, ".black-agents/knowledge/metrics/revenue.md"),
      "utf8"
    )
    expect(file).toContain("type: Metric")
    expect(file).toContain("human:local")
    expect(file).toContain("Revenue.")

    const again = await call({ action: "queue", path: root, id: "metrics/revenue" })
    expect(again.status).toBe(409)
  })
})
