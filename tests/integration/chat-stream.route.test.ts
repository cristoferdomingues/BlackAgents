import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/chat/route"
import { POST as DECIDE } from "@/app/api/approvals/[id]/route"
import { GET as LIST } from "@/app/api/approvals/route"
import { listPendingApprovals } from "@/lib/runtime/approvals"
import { setProviderSecret } from "@/lib/secrets"
import { parseSseFrames } from "@/lib/sse-client"

import { jsonRequest, makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv

function openAIReply(message: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) }
}

function writeCall(id: string) {
  return {
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: { name: "fs_write", arguments: JSON.stringify({ path: "notes.md", content: "hi" }) },
      },
    ],
  }
}

function streamRequest(body: Record<string, unknown>): Request {
  return new Request("http://t/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Write notes" }],
      ...body,
    }),
  })
}

async function waitForApproval(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const pending = listPendingApprovals()
    if (pending.length > 0) return pending[0].id
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error("no approval appeared")
}

beforeEach(async () => {
  env = await makeTempEnv()
  await setProviderSecret("openai", {
    apiKey: "sk-valid",
    verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
  })
  await seedArtifact(
    env.workspace,
    ".cursor/agents/writer.md",
    "---\nname: writer\ndescription: Writes notes.\ntools: [fs_write]\n---\nUse the `style` rule.\n"
  )
  await seedArtifact(
    env.workspace,
    ".cursor/rules/style.mdc",
    "---\ndescription: House style.\n---\nUse short sentences.\n"
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("POST /api/chat streaming", () => {
  it("streams context, waits for approval, then writes and finishes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAIReply(writeCall("c1")))
      .mockResolvedValueOnce(openAIReply({ content: "Saved your notes." }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(streamRequest({ agent: "writer" }))
    const textPromise = response.text()
    const id = await waitForApproval()
    const listed = (await (await LIST()).json()) as { data: { approvals: Array<{ id: string; tool: string }> } }
    expect(listed.data.approvals[0]).toMatchObject({ id, tool: "fs_write" })

    const decided = await DECIDE(jsonRequest(`http://t/api/approvals/${id}`, "POST", { approved: true }), {
      params: Promise.resolve({ id }),
    })
    expect(decided.status).toBe(200)

    const { events } = parseSseFrames(await textPromise)
    const names = events.map((e) => e.event)
    expect(names[0]).toBe("context")
    expect(events[0].data).toMatchObject({
      artifacts: [{ type: "rule", name: "style", source: "linked" }],
      jev: "off",
    })
    expect(names).toEqual(
      expect.arrayContaining(["tool_call", "approval_required", "approval_resolved", "tool_result", "token", "done"])
    )
    expect(events.at(-1)).toMatchObject({ event: "done", data: { content: "Saved your notes." } })
    expect(await readFile(path.join(env.workspace, "notes.md"), "utf8")).toBe("hi")

    const system = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
      tools: Array<{ function: { name: string } }>
    }
    expect(system.messages[0].content).toContain("Use short sentences.")
    expect(system.tools.map((t) => t.function.name)).toEqual(["fs_write"])
  })

  it("auto-approves writes when allowWrites is set", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(openAIReply(writeCall("c1")))
        .mockResolvedValueOnce(openAIReply({ content: "done" }))
    )
    const response = await POST(streamRequest({ agent: "writer", allowWrites: true }))
    const { events } = parseSseFrames(await response.text())
    expect(events.some((e) => e.event === "approval_required")).toBe(false)
    expect(await readFile(path.join(env.workspace, "notes.md"), "utf8")).toBe("hi")
  })

  it("denies approval-gated calls in JSON mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(openAIReply(writeCall("c1")))
        .mockResolvedValueOnce(openAIReply({ content: "I could not write." }))
    )
    const response = await POST(
      jsonRequest("http://t/api/chat", "POST", {
        provider: "openai",
        messages: [{ role: "user", content: "Write notes" }],
        agent: "writer",
      })
    )
    const body = (await response.json()) as {
      data: { toolExecutions: Array<{ error: string }> }
    }
    expect(body.data.toolExecutions[0].error).toMatch(/approval/)
  })

  it("sends provider errors as an error event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    )
    const response = await POST(streamRequest({}))
    const { events } = parseSseFrames(await response.text())
    expect(events.at(-1)).toMatchObject({ event: "error", data: { status: 500 } })
  })

  it("rejects decisions for unknown approvals", async () => {
    const res = await DECIDE(jsonRequest("http://t/api/approvals/nope", "POST", { approved: true }), {
      params: Promise.resolve({ id: "nope" }),
    })
    expect(res.status).toBe(404)
    const bad = await DECIDE(jsonRequest("http://t/api/approvals/nope", "POST", {}), {
      params: Promise.resolve({ id: "nope" }),
    })
    expect(bad.status).toBe(400)
  })
})
