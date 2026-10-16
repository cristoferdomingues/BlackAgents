import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET } from "@/app/api/knowledge/route"
import { decideProposal } from "@/lib/brain/learn"
import { listProposals } from "@/lib/brain/store"
import { POST } from "@/app/api/knowledge/import/route"
import { makeTempEnv, jsonRequest, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

function get(id?: string): Promise<Response> {
  const url = id ? `http://t/api/knowledge?id=${encodeURIComponent(id)}` : "http://t/api/knowledge"
  return GET(new Request(url))
}

describe("GET /api/knowledge", () => {
  it("lists nothing, then opens a concept after it is approved", async () => {
    expect((await get()).status).toBe(200)
    expect((await (await get()).json()).data.concepts).toEqual([])

    const vault = path.join(env.workspace, "vault")
    await seedArtifact(env.workspace, "vault/Start.md", "---\ntype: reference\n---\n# Start\n\nHello.\n")
    const queued = await POST(
      jsonRequest("http://t/api/knowledge/import", "POST", {
        action: "queue-obsidian",
        path: vault,
        ids: ["start"],
      })
    )
    expect(queued.status).toBe(201)
    const [proposal] = await listProposals(env.workspace)
    await decideProposal(env.workspace, proposal.id, { action: "approve" })

    const list = await get()
    expect((await list.json()).data.concepts).toMatchObject([
      { id: "start", title: "Start", trust: "human-reviewed", folder: "" },
    ])
    const one = await get("start")
    expect(one.status).toBe(200)
    expect((await one.json()).data.body).toContain("Hello.")
    expect(await readFile(path.join(env.workspace, ".black-agents/knowledge/start.md"), "utf8")).toContain("Hello.")
  })

  it("rejects a bad id and a missing concept", async () => {
    expect((await get("Bad Id")).status).toBe(400)
    expect((await get("missing")).status).toBe(404)
  })
})
