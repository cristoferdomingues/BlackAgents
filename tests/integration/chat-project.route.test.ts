import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/chat/route"
import { setProviderSecret } from "@/lib/secrets"
import { workflowSchema } from "@/lib/workflows/schema"
import { jsonRequest, makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
  await setProviderSecret("openai", {
    apiKey: "sk-valid",
    verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
  })
  await seedProject(env.workspace, "study", { name: "Study" })
  await seedArtifact(
    env.workspace,
    ".black-agents/projects/study/artifacts/agents/study-coach.md",
    "---\nname: study-coach\ndescription: Quizzes the user.\n---\nYou ask exam questions.\n"
  )
  await seedArtifact(
    env.workspace,
    ".black-agents/projects/study/workflows/drill.workflow.json",
    JSON.stringify(
      workflowSchema.parse({ name: "drill", task: "Drill me", steps: [{ id: "quiz", agent: "study-coach" }] })
    )
  )
  await seedArtifact(
    env.workspace,
    ".black-agents/workflows/ship.workflow.json",
    JSON.stringify(workflowSchema.parse({ name: "ship", task: "Ship", steps: [{ id: "one", agent: "demo" }] }))
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

function chatRequest(url: string, body: Record<string, unknown> = {}): Request {
  return jsonRequest(url, "POST", {
    provider: "openai",
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Use @agent:study-coach to quiz me" }],
    ...body,
  })
}

function stubReply(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "ok" } }] }),
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function systemPrompt(fetchMock: ReturnType<typeof vi.fn>): string {
  const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
    messages: Array<{ content: string }>
  }
  return body.messages[0]?.content ?? ""
}

describe("POST /api/chat in a project", () => {
  it("shows the assistant the project's agents and workflows as saved", async () => {
    const fetchMock = stubReply()
    const response = await POST(chatRequest("http://t/api/chat?scope=study"))
    expect(response.status).toBe(200)

    const system = systemPrompt(fetchMock)
    expect(system).toContain('## Active project\n\nThe user is working in the project "Study" (id: study).')
    expect(system).toContain("do not ask the user to save it again")
    expect(system).toMatch(/- agent\/study-coach — .*Quizzes the user\./)
    expect(system).toContain("- drill — (no description) — steps: study-coach")
    expect(system).not.toContain("- ship —")
    expect(system).toContain("You ask exam questions.")
  })

  it("runs a project-only agent as the persona", async () => {
    const fetchMock = stubReply()
    const response = await POST(chatRequest("http://t/api/chat?scope=study", { agent: "study-coach" }))
    expect(response.status).toBe(200)
    expect(systemPrompt(fetchMock)).toContain("You ask exam questions.")
  })

  it("does not see project items without the scope", async () => {
    const fetchMock = stubReply()
    const missing = await POST(chatRequest("http://t/api/chat", { agent: "study-coach" }))
    expect(missing.status).toBe(404)

    await POST(chatRequest("http://t/api/chat"))
    const system = systemPrompt(fetchMock)
    expect(system).not.toContain("## Active project")
    expect(system).not.toContain("agent/study-coach")
    expect(system).toContain("- ship —")
  })

  it("rejects a project that does not load", async () => {
    stubReply()
    const response = await POST(chatRequest("http://t/api/chat?scope=nope"))
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toContain('Project "nope" is not available')
  })
})
