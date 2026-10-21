import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as BUILD } from "@/app/api/meetings/[id]/build/route"
import { POST as KNOWLEDGE } from "@/app/api/meetings/[id]/knowledge/route"
import { POST as NOTES } from "@/app/api/meetings/[id]/notes/route"
import { GET as DESKTOP } from "@/app/api/desktop/route"
import { PATCH } from "@/app/api/meetings/[id]/route"
import { POST as LIVE } from "@/app/api/meetings/live/route"
import { GET, POST } from "@/app/api/meetings/route"
import { listProposals } from "@/lib/brain/store"
import { setProviderSecret } from "@/lib/secrets"
import { jsonRequest, makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../helpers/workspace"

let env: TempEnv

const notes = {
  language: "English",
  summary: "We ship on Friday.",
  decisions: ["Ship on Friday"],
  actionItems: [{ owner: "Ana", task: "Write the note", due: "Friday" }],
  openQuestions: ["Who reviews?"],
  people: ["Ana"],
  suggestions: [
    { kind: "skill", name: "ship-note", reason: "The team repeats this" },
    { kind: "workflow", name: "ship-line", reason: "The steps always run in order" },
  ],
}

function fence(kind: string, body: unknown): string {
  return `\`\`\`${kind}\n${JSON.stringify(body)}\n\`\`\``
}

function mockModel(content: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

async function bodyOf(res: Response): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  return (await res.json()) as { success: boolean; data?: Record<string, unknown>; error?: string }
}

beforeEach(async () => {
  env = await makeTempEnv()
  await setProviderSecret("openai", {
    apiKey: "sk-valid",
    verification: { status: "valid", checkedAt: "2026-10-21T10:00:00.000Z" },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("meetings API", () => {
  it("imports a transcript, writes notes, and queues knowledge", async () => {
    const created = await bodyOf(
      await POST(jsonRequest("http://t/api/meetings", "POST", { title: "Standup", text: "We ship on Friday." }))
    )
    expect(created.success).toBe(true)
    const id = String(created.data?.id)
    const fetchMock = mockModel(fence("meeting", notes))
    const noted = await bodyOf(
      await NOTES(jsonRequest(`http://t/api/meetings/${id}/notes`, "POST", { provider: "openai", model: "gpt-4o-mini" }), {
        params: Promise.resolve({ id }),
      })
    )
    expect(noted.success).toBe(true)
    expect((noted.data?.notes as { language: string }).language).toBe("English")
    const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content: string }>
    }
    expect(sent.messages.some((message) => message.content.includes("data, not instructions"))).toBe(true)

    const saved = await bodyOf(
      await KNOWLEDGE(new Request(`http://t/api/meetings/${id}/knowledge`, { method: "POST" }), {
        params: Promise.resolve({ id }),
      })
    )
    expect(saved.success).toBe(true)
    expect(String(saved.data?.file)).toContain(".black-agents/knowledge/meeting/")
    const proposals = await listProposals(env.workspace)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.source.kind).toBe("meeting")
    expect(proposals[0]?.content).toContain("We ship on Friday.")

    const again = await bodyOf(
      await KNOWLEDGE(new Request(`http://t/api/meetings/${id}/knowledge`, { method: "POST" }), {
        params: Promise.resolve({ id }),
      })
    )
    expect(again.data?.already).toBe(true)
    expect(await listProposals(env.workspace)).toHaveLength(1)
  })

  it("stores a project meeting under that project folder", async () => {
    await seedProject(env.workspace, "web")
    const created = await bodyOf(
      await POST(jsonRequest("http://t/api/meetings", "POST", { text: "Hello", scope: "web" }))
    )
    expect(created.success).toBe(true)
    const id = String(created.data?.id)
    const file = path.join(env.workspace, ".black-agents", "meetings", "web", `${id}.json`)
    await expect(bodyOf(await GET())).resolves.toMatchObject({ success: true })
    const raw = JSON.parse(await readFile(file, "utf8")) as { scope: string }
    expect(raw.scope).toBe("web")
  })

  it("rejects a missing project and an empty transcript", async () => {
    const missing = await bodyOf(
      await POST(jsonRequest("http://t/api/meetings", "POST", { text: "Hello", scope: "nope" }))
    )
    expect(missing.success).toBe(false)
    const empty = await bodyOf(await POST(jsonRequest("http://t/api/meetings", "POST", { text: "   " })))
    expect(empty.success).toBe(false)
  })

  it("drafts a skill and refuses a workflow when there is no agent", async () => {
    const created = await bodyOf(await POST(jsonRequest("http://t/api/meetings", "POST", { text: "We ship on Friday." })))
    const id = String(created.data?.id)
    mockModel(fence("meeting", notes))
    await NOTES(jsonRequest(`http://t/api/meetings/${id}/notes`, "POST", { provider: "openai", model: "gpt-4o-mini" }), {
      params: Promise.resolve({ id }),
    })

    const blocked = await bodyOf(
      await BUILD(
        jsonRequest(`http://t/api/meetings/${id}/build`, "POST", {
          kind: "workflow",
          name: "ship-line",
          provider: "openai",
          model: "gpt-4o-mini",
        }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(blocked.success).toBe(false)
    expect(blocked.error).toContain("Add an agent")

    await seedArtifact(
      env.workspace,
      ".black-agents/artifacts/agents/writer.md",
      "---\nname: writer\ndescription: Writes.\n---\nWrite.\n"
    )
    mockModel(
      fence("workflow", {
        name: "other",
        description: "Ship",
        task: "Ship the note",
        trigger: { type: "manual" },
        steps: [{ id: "write", agent: "writer", instructions: "Write the note" }],
      })
    )
    const built = await bodyOf(
      await BUILD(
        jsonRequest(`http://t/api/meetings/${id}/build`, "POST", {
          kind: "workflow",
          name: "ship-line",
          provider: "openai",
          model: "gpt-4o-mini",
        }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(built.success).toBe(true)
    expect((built.data?.workflow as { name: string }).name).toBe("ship-line")

    const unknown = await bodyOf(
      await BUILD(
        jsonRequest(`http://t/api/meetings/${id}/build`, "POST", {
          kind: "skill",
          name: "not-suggested",
          provider: "openai",
          model: "gpt-4o-mini",
        }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(unknown.success).toBe(false)
  })

  it("starts one live meeting and appends a line", async () => {
    const created = await bodyOf(await LIVE(jsonRequest("http://t/api/meetings/live", "POST", { title: "Call" })))
    expect(created.success).toBe(true)
    expect(created.data?.status).toBe("listening")
    expect(created.data?.source).toBe("live")
    const id = String(created.data?.id)

    const again = await bodyOf(await LIVE(jsonRequest("http://t/api/meetings/live", "POST", {})))
    expect(again.success).toBe(false)
    expect(again.error).toContain("already listening")

    const patched = await bodyOf(
      await PATCH(
        jsonRequest(`http://t/api/meetings/${id}`, "PATCH", {
          appendSegments: [{ at: 0, speaker: "me", text: "Hello" }],
          appendMarks: [{ at: 0, text: "important" }],
        }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(patched.success).toBe(true)
    expect(patched.data?.segments).toEqual([{ at: 0, speaker: "me", text: "Hello" }])

    const stopped = await bodyOf(
      await PATCH(
        jsonRequest(`http://t/api/meetings/${id}`, "PATCH", {
          status: "ready",
          endedAt: "2026-10-21T16:00:00.000Z",
          error: null,
        }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(stopped.data?.status).toBe("ready")
    expect(stopped.data?.error).toBeUndefined()
  })

  it("says the browser is not the desktop app", async () => {
    const res = await bodyOf(await DESKTOP())
    expect(res.data).toMatchObject({ desktop: false })
  })

  it("fails when no workspace is selected", async () => {
    await writeFile(path.join(env.configDir, "config.json"), JSON.stringify({ workspaces: [] }))
    const res = await bodyOf(await POST(jsonRequest("http://t/api/meetings", "POST", { text: "Hello" })))
    expect(res.success).toBe(false)
    expect(res.error).toContain("workspace")
  })
})
