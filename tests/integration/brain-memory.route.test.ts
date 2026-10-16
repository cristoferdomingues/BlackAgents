import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { POST } from "@/app/api/brain/memory/route"
import { decideProposal } from "@/lib/brain/learn"
import { listProposals } from "@/lib/brain/store"
import { jsonRequest, makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const draft = {
  title: "How to address the user",
  content: "Call the user Mr. Bombastic.",
}

function call(body: unknown): Promise<Response> {
  return POST(jsonRequest("http://t/api/brain/memory", "POST", body))
}

describe("POST /api/brain/memory", () => {
  it("queues a note for every agent and writes it only after approval", async () => {
    const res = await call(draft)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data).toMatchObject({ title: draft.title, agent: null })

    const notePath = path.join(env.workspace, ".black-agents/brain/workspace.md")
    await expect(readFile(notePath, "utf8")).rejects.toThrow()

    const [proposal] = await listProposals(env.workspace)
    expect(proposal).toMatchObject({
      id: json.data.proposalId,
      kind: "memory_note",
      source: { kind: "assistant" },
      status: "pending",
      content: draft.content,
    })
    expect(proposal.agent).toBeUndefined()

    await decideProposal(env.workspace, proposal.id, { action: "approve" })
    const saved = await readFile(notePath, "utf8")
    expect(saved).toContain("Call the user Mr. Bombastic.")
  })

  it("queues a note for one existing agent", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/coder.md",
      "---\nname: coder\ndescription: Writes code.\n---\nYou write code.\n"
    )
    const res = await call({ ...draft, agent: "coder" })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.agent).toBe("coder")

    const notePath = path.join(env.workspace, ".black-agents/brain/agents/coder.md")
    await expect(readFile(notePath, "utf8")).rejects.toThrow()

    await decideProposal(env.workspace, json.data.proposalId, { action: "approve" })
    const saved = await readFile(notePath, "utf8")
    expect(saved).toContain("Call the user Mr. Bombastic.")
    await expect(
      readFile(path.join(env.workspace, ".black-agents/brain/workspace.md"), "utf8")
    ).rejects.toThrow()
  })

  it("returns 404 when the named agent does not exist", async () => {
    const res = await call({ ...draft, agent: "missing" })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain("missing")
  })

  it("returns 400 for invalid model output", async () => {
    const res = await call({ ...draft, content: "" })
    expect(res.status).toBe(400)
    expect((await res.json()).success).toBe(false)
  })

  it("returns 412 when no workspace is selected", async () => {
    await writeFile(
      path.join(env.configDir, "config.json"),
      JSON.stringify({ workspaces: [] }),
      "utf8"
    )
    const res = await call(draft)
    expect(res.status).toBe(412)
    expect((await res.json()).error).toBe("No workspace selected")
  })
})
