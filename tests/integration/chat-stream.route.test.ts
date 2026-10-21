import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/chat/route"
import { POST as DECIDE } from "@/app/api/approvals/[id]/route"
import { GET as LIST } from "@/app/api/approvals/route"
import { listPendingApprovals, requestApproval } from "@/lib/runtime/approvals"
import { setProviderSecret } from "@/lib/secrets"
import { updateAiSettings } from "@/lib/settings"
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
  it("sends the model price and the tokens of each model call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Hi." } }],
          usage: { prompt_tokens: 1200, completion_tokens: 80 },
        }),
      })
    )
    const { events } = parseSseFrames(await (await POST(streamRequest({}))).text())
    expect(events[0].data).toMatchObject({ price: { inputPerMTok: 0.15, outputPerMTok: 0.6, source: "list" } })
    const response = events.find((e) => e.event === "llm_response")
    expect(response?.data).toMatchObject({ usage: { inputTokens: 1200, outputTokens: 80 } })
    expect(JSON.stringify(events)).not.toContain("sk-valid")
  })

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
    expect(system.tools.map((t) => t.function.name)).toEqual(["fs_write", "fs_edit"])
  })

  it("gives the assistant fs_write and allows the rest of the message after one yes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        openAIReply({
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "fs_write", arguments: JSON.stringify({ path: "a.md", content: "a" }) },
            },
            {
              id: "c2",
              type: "function",
              function: { name: "fs_write", arguments: JSON.stringify({ path: "b.md", content: "b" }) },
            },
          ],
        })
      )
      .mockResolvedValueOnce(openAIReply({ content: "Saved both." }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(streamRequest({}))
    const textPromise = response.text()
    const id = await waitForApproval()
    const decided = await DECIDE(
      jsonRequest(`http://t/api/approvals/${id}`, "POST", { approved: true, fileWritePermission: "message" }),
      { params: Promise.resolve({ id }) }
    )
    expect((await decided.json()).data.fileWritePermission).toBe("message")

    const { events } = parseSseFrames(await textPromise)
    expect(events.filter((event) => event.event === "approval_required")).toHaveLength(1)
    expect(await readFile(path.join(env.workspace, "a.md"), "utf8")).toBe("a")
    expect(await readFile(path.join(env.workspace, "b.md"), "utf8")).toBe("b")
    const system = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      tools: Array<{ function: { name: string } }>
    }
    expect(system.tools.map((tool) => tool.function.name)).toEqual([
      "fs_list",
      "fs_read",
      "fs_find",
      "fs_search",
      "fs_write",
      "fs_edit",
      "shell_run",
    ])
  })

  it("skips the file-write ask when the Assistant setting is on", async () => {
    await updateAiSettings({ assistant: { autoApproveFileWrites: true } })
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(openAIReply(writeCall("c1")))
        .mockResolvedValueOnce(openAIReply({ content: "done" }))
    )
    const response = await POST(streamRequest({}))
    const { events } = parseSseFrames(await response.text())
    expect(events.some((event) => event.event === "approval_required")).toBe(false)
    expect(await readFile(path.join(env.workspace, "notes.md"), "utf8")).toBe("hi")
  })

  it("still asks an agent to write when the Assistant setting is on", async () => {
    await updateAiSettings({ assistant: { autoApproveFileWrites: true } })
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(openAIReply(writeCall("c1")))
        .mockResolvedValueOnce(openAIReply({ content: "done" }))
    )
    const response = await POST(streamRequest({ agent: "writer" }))
    const textPromise = response.text()
    const id = await waitForApproval()
    await DECIDE(jsonRequest(`http://t/api/approvals/${id}`, "POST", { approved: true }), {
      params: Promise.resolve({ id }),
    })
    const { events } = parseSseFrames(await textPromise)
    expect(events.some((event) => event.event === "approval_required")).toBe(true)
  })

  it("accepts file-write permission only for a chat fs_write", async () => {
    const write = requestApproval({
      tool: "fs_write",
      server: "builtin",
      risk: "write",
      summary: "Write a.md",
      args: { path: "a.md" },
      scope: { kind: "chat" },
    })
    const allowed = await DECIDE(
      jsonRequest(`http://t/api/approvals/${write.request.id}`, "POST", {
        approved: true,
        fileWritePermission: "session",
      }),
      { params: Promise.resolve({ id: write.request.id }) }
    )
    expect((await allowed.json()).data).toMatchObject({
      approved: true,
      remember: false,
      fileWritePermission: "session",
    })
    await expect(write.decision).resolves.toMatchObject({ fileWritePermission: "session" })

    const shell = requestApproval({
      tool: "shell_run",
      server: "builtin",
      risk: "exec",
      summary: "$ ls",
      args: { command: "ls" },
      scope: { kind: "chat" },
    })
    const ignored = await DECIDE(
      jsonRequest(`http://t/api/approvals/${shell.request.id}`, "POST", {
        approved: true,
        fileWritePermission: "session",
      }),
      { params: Promise.resolve({ id: shell.request.id }) }
    )
    expect((await ignored.json()).data.fileWritePermission).toBeUndefined()
    await expect(shell.decision).resolves.toEqual({ approved: true, remember: false })
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

  it("refuses a knowledge file with no OKF frontmatter, even once the write is approved", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        openAIReply({
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "fs_write",
                arguments: JSON.stringify({
                  path: ".black-agents/knowledge/revenue.md",
                  content: "# Revenue\n\nJust a note, no frontmatter.\n",
                }),
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(openAIReply({ content: "I could not save that as knowledge." }))
    vi.stubGlobal("fetch", fetchMock)

    // `.black-agents/` is a protected prefix, so this write still asks (exec risk) even with allowWrites.
    const response = await POST(streamRequest({ agent: "writer", allowWrites: true }))
    const textPromise = response.text()
    const id = await waitForApproval()
    await DECIDE(jsonRequest(`http://t/api/approvals/${id}`, "POST", { approved: true }), {
      params: Promise.resolve({ id }),
    })

    const { events } = parseSseFrames(await textPromise)
    const result = events.find((e) => e.event === "tool_result")
    expect(result?.data).toMatchObject({
      trace: { error: expect.stringContaining("not a valid OKF knowledge concept") },
    })
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { content: "I could not save that as knowledge." },
    })
    await expect(
      readFile(path.join(env.workspace, ".black-agents/knowledge/revenue.md"), "utf8")
    ).rejects.toThrow()

    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(second.messages.at(-1)?.content).toContain("not a valid OKF knowledge concept")
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

  it("injects @file:<name> workspace file metadata and absolutePath into the chat system context", async () => {
    const { saveWorkspaceFile } = await import("@/lib/files")
    const savedFile = await saveWorkspaceFile(env.workspace, {
      name: "expense-receipt",
      originalName: "Receipt_2026.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 receipt"),
      description: "Expense receipt for form upload",
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(openAIReply({ content: "Uploaded your receipt." }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(
      streamRequest({
        agent: "writer",
        messages: [{ role: "user", content: "Upload @file:expense-receipt in the browser form" }],
      })
    )
    await response.text()

    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(payload.messages[0].content).toContain("## Workspace files for this task")
    expect(payload.messages[0].content).toContain(savedFile.absolutePath)
    expect(payload.messages[0].content).toContain("browser_file_upload")
  })

  it("supports built-in agents and auto-loads built-in skills and rules for workflow or browser questions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAIReply({ content: "Here is your workflow." }))
      .mockResolvedValueOnce(openAIReply({ content: "Use Settings -> Browser." }))
    vi.stubGlobal("fetch", fetchMock)

    // 1. Direct built-in agent persona (`workflow-architect`) loads its linked rule and skills
    const personaRes = await POST(
      streamRequest({
        agent: "workflow-architect",
        messages: [{ role: "user", content: "Design a daily workflow" }],
      })
    )
    const { events: personaEvents } = parseSseFrames(await personaRes.text())
    expect(personaEvents[0].data).toMatchObject({
      artifacts: [
        { type: "rule", name: "workflow-guardrails", source: "linked" },
        { type: "skill", name: "workflows-guide", source: "linked" },
        { type: "skill", name: "platform-modules", source: "linked" },
      ],
    })

    // 2. Generic assistant auto-loads `browser-automation` skill + `browser-automation-guardrails` rule
    const genericRes = await POST(
      streamRequest({
        messages: [{ role: "user", content: "How do I use automated browsing and record a flow?" }],
      })
    )
    const { events: genericEvents } = parseSseFrames(await genericRes.text())
    expect(genericEvents[0].data).toMatchObject({
      artifacts: [
        { type: "skill", name: "browser-automation", source: "auto" },
        { type: "rule", name: "browser-automation-guardrails", source: "linked" },
        { type: "skill", name: "platform-modules", source: "linked" },
      ],
    })
  })
})
