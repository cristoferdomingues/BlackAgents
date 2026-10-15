import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { POST } from "@/app/api/brain/promote/route"
import { decideProposal } from "@/lib/brain/learn"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

function call(body: unknown): Promise<Response> {
  return POST(jsonRequest("http://t/api/brain/promote", "POST", body))
}

describe("POST /api/brain/promote", () => {
  it("queues a concept and writes the file only after approval", async () => {
    const res = await call({ id: "metrics/revenue", type: "Metric", content: "Revenue.", title: "Revenue" })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.kind).toBe("new_concept")
    await expect(readFile(path.join(env.workspace, ".black-agents/knowledge/metrics/revenue.md"), "utf8")).rejects.toThrow()

    await decideProposal(env.workspace, json.data.proposalId, { action: "approve" })
    const saved = await readFile(path.join(env.workspace, ".black-agents/knowledge/metrics/revenue.md"), "utf8")
    expect(saved).toContain("type: Metric")
    expect(saved).toContain("human:local")
    expect(saved).not.toContain("verified:\n  - by: human:local\n  - by: human:local")
  })

  it("rejects a bad id and a missing workspace field", async () => {
    expect((await call({ id: "Bad", type: "Metric", content: "no" })).status).toBe(400)
    expect((await call({ type: "Metric", content: "no" })).status).toBe(400)
  })
})