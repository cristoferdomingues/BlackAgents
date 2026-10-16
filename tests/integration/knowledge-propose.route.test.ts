import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { POST } from "@/app/api/knowledge/propose/route"
import { decideProposal } from "@/lib/brain/learn"
import { listProposals } from "@/lib/brain/store"
import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const draft = {
  id: "architecture/agent-loop",
  type: "Design Decision",
  title: "Agent loop",
  description: "How the bounded loop works.",
  body: "The loop has a fixed turn limit.",
  tags: ["runtime"],
  sources: [{ resource: "https://example.com/runtime", title: "Runtime docs" }],
}

function call(body: unknown): Promise<Response> {
  return POST(jsonRequest("http://t/api/knowledge/propose", "POST", body))
}

describe("POST /api/knowledge/propose", () => {
  it("queues a draft and writes only after Inbox approval", async () => {
    const res = await call(draft)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data).toMatchObject({ title: "Agent loop", kind: "new_concept" })
    const conceptPath = path.join(
      env.workspace,
      ".black-agents/knowledge/architecture/agent-loop.md"
    )
    await expect(readFile(conceptPath, "utf8")).rejects.toThrow()

    const [proposal] = await listProposals(env.workspace)
    expect(proposal).toMatchObject({
      id: json.data.proposalId,
      kind: "new_concept",
      source: { kind: "assistant" },
      status: "pending",
    })
    expect(proposal.concept?.verified).toBeUndefined()
    expect(proposal.concept?.generated?.by).toBe("process:assistant-chat")

    await decideProposal(env.workspace, proposal.id, { action: "approve" })
    const saved = await readFile(conceptPath, "utf8")
    expect(saved).toContain("process:assistant-chat")
    expect(saved).toContain("human:local")
    expect(saved).toContain("The loop has a fixed turn limit.")
  })

  it("returns 400 for invalid model output", async () => {
    const res = await call({ ...draft, id: "Bad Id" })
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
