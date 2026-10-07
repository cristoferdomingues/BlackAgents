import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "@/app/api/brain/route"
import { POST as FEEDBACK } from "@/app/api/brain/feedback/route"
import { POST as DECIDE } from "@/app/api/brain/proposals/[id]/route"
import type { BrainOverview, FeedbackResult } from "@/lib/brain/types"
import { setProviderSecret } from "@/lib/secrets"

import { jsonRequest, makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv

async function read<T>(res: Response): Promise<{ status: number; data?: T; error?: string }> {
  const body = (await res.json()) as { data?: T; error?: string }
  return { status: res.status, ...body }
}

const byId = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(async () => {
  env = await makeTempEnv()
  await seedArtifact(env.workspace, ".cursor/agents/coder.md", "---\nname: coder\ndescription: Codes.\n---\nYou code.\n")
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("brain routes", () => {
  it("returns an empty overview", async () => {
    const res = await read<BrainOverview>(await GET())
    expect(res.data).toEqual({ proposals: [], workspaceNotes: [], agents: [] })
  })

  it("validates feedback and records it without Jev", async () => {
    expect((await read(await FEEDBACK(jsonRequest("http://t", "POST", { source: "nope" })))).status).toBe(400)
    const res = await read<FeedbackResult>(
      await FEEDBACK(jsonRequest("http://t", "POST", { source: "chat", rating: "up", userMessage: "q", reply: "a" }))
    )
    expect(res.data?.kind).toBe("recorded")
  })

  it("turns a comment into a proposal and applies it", async () => {
    await setProviderSecret("openai", {
      apiKey: "sk-valid",
      verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
    })
    const draft = "```proposal\n" + JSON.stringify({ action: "memory_note", content: "Use tabs" }) + "\n```"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: draft } }] }) }))
    )
    const res = await read<FeedbackResult>(
      await FEEDBACK(
        jsonRequest("http://t", "POST", {
          source: "chat",
          agent: "coder",
          rating: "down",
          comment: "We use tabs",
          userMessage: "format",
          reply: "spaces",
          provider: "openai",
          model: "gpt-4o-mini",
        })
      )
    )
    expect(res.data?.kind).toBe("proposed")
    const id = res.data?.kind === "proposed" ? res.data.proposalId : ""

    expect((await read(await DECIDE(jsonRequest("http://t", "POST", { action: "maybe" }), byId(id)))).status).toBe(400)
    expect((await read(await DECIDE(jsonRequest("http://t", "POST", { action: "approve" }), byId(id)))).status).toBe(200)
    expect((await read(await DECIDE(jsonRequest("http://t", "POST", { action: "approve" }), byId(id)))).status).toBe(409)
    expect((await read(await DECIDE(jsonRequest("http://t", "POST", { action: "reject" }), byId("missing")))).status).toBe(404)

    const overview = await read<BrainOverview>(await GET())
    expect(overview.data?.agents).toEqual([{ name: "coder", notes: [expect.objectContaining({ text: "Use tabs" })] }])
    expect(overview.data?.proposals[0].status).toBe("approved")
  })
})
