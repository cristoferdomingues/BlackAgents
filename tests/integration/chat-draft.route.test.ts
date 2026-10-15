import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/chat/route"
import { setProviderSecret } from "@/lib/secrets"
import { jsonRequest, makeTempEnv, seedArtifact, type TempEnv } from "../helpers/workspace"

let env: TempEnv

interface SentPayload {
  messages: Array<{ role: string; content: string }>
  tools?: Array<{ function: { name: string } }>
}

function mockReply(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "Done." } }] }),
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function sent(fetchMock: ReturnType<typeof vi.fn>): SentPayload {
  return JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as SentPayload
}

function chat(body: Record<string, unknown>, content = "Hello"): Request {
  return jsonRequest("http://t/api/chat", "POST", {
    provider: "openai",
    model: "gpt-4o-mini",
    messages: [{ role: "user", content }],
    ...body,
  })
}

const agentDraft = {
  type: "agent",
  platform: "cursor",
  name: "tester",
  description: "Writes tests.",
  body: "You are the unsaved tester persona.",
  extra: { tools: ["fs_list", "fs_read", "shell_run"] },
}

beforeEach(async () => {
  env = await makeTempEnv()
  await setProviderSecret("openai", {
    apiKey: "sk-valid",
    verification: { status: "valid", checkedAt: "2026-10-14T10:00:00.000Z" },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("POST /api/chat with an editor draft", () => {
  it("uses an unsaved agent draft as the persona with its own tools", async () => {
    const fetchMock = mockReply()
    const res = await POST(chat({ draft: agentDraft }))
    expect(res.status).toBe(200)
    const payload = sent(fetchMock)
    const system = payload.messages[0]?.content ?? ""
    expect(system).toContain("You are the unsaved tester persona.")
    expect(system).toContain("Writes tests.")
    expect(payload.tools?.map((t) => t.function.name)).toEqual(["fs_list", "fs_read", "fs_find", "fs_search", "shell_run"])
  })

  it("prefers the draft over the saved agent with the same name", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/agents/tester.md",
      "---\nname: tester\ndescription: Saved.\n---\nSAVED PERSONA TEXT\n"
    )
    const fetchMock = mockReply()
    await POST(chat({ draft: agentDraft, agent: "tester" }))
    const system = sent(fetchMock).messages[0]?.content ?? ""
    expect(system).toContain("You are the unsaved tester persona.")
    expect(system).not.toContain("SAVED PERSONA TEXT")
  })

  it("adds a rule draft to the context and hides its saved version", async () => {
    await seedArtifact(
      env.workspace,
      ".cursor/rules/style.mdc",
      "---\ndescription: House style.\n---\nOLD RULE TEXT\n"
    )
    const fetchMock = mockReply()
    const res = await POST(
      chat(
        {
          draft: {
            type: "rule",
            platform: "cursor",
            name: "style",
            description: "House style.",
            body: "- Answer in one line.",
            extra: { alwaysApply: true },
          },
        },
        "Follow @rule:style please"
      )
    )
    expect(res.status).toBe(200)
    const system = sent(fetchMock).messages[0]?.content ?? ""
    expect(system).toContain("## Draft rule being tried")
    expect(system).toContain("- Answer in one line.")
    expect(system).not.toContain("OLD RULE TEXT")
  })

  it("rejects an invalid draft before calling the provider", async () => {
    const fetchMock = mockReply()
    const res = await POST(chat({ draft: { ...agentDraft, name: "Not Kebab" } }))
    expect(res.status).toBe(400)
    expect((await res.json()).success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a draft with an unknown tool", async () => {
    const fetchMock = mockReply()
    const res = await POST(chat({ draft: { ...agentDraft, extra: { tools: ["rm_rf"] } } }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
