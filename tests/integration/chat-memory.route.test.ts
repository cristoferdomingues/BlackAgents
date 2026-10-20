import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/chat/route"
import { KEEP_RECENT_MESSAGES, type ConversationMemory } from "@/lib/chat/memory"
import { setProviderSecret } from "@/lib/secrets"
import { updateAiSettings } from "@/lib/settings"
import { parseSseFrames } from "@/lib/sse-client"
import { jsonRequest, makeTempEnv, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
  await setProviderSecret("openai", {
    apiKey: "sk-valid",
    verification: { status: "valid", checkedAt: "2026-08-21T10:00:00.000Z" },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

const FOLD_REPLY =
  '```conversation-memory\n{ "facts": ["The quiz agent is study-coach", "Exam code: CCA-F"], "summary": "The user set up a quiz agent." }\n```'

function history(count: number): Array<{ role: "user" | "assistant"; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }))
}

function reply(content: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
}

interface SentRequest {
  model: string
  messages: Array<{ role: string; content: string }>
}

function sent(fetchMock: ReturnType<typeof vi.fn>, index: number): SentRequest {
  return JSON.parse(String((fetchMock.mock.calls[index]?.[1] as RequestInit).body)) as SentRequest
}

function chat(body: Record<string, unknown>): Promise<Response> {
  return POST(jsonRequest("http://t/api/chat", "POST", { provider: "openai", model: "gpt-4o", ...body }))
}

describe("POST /api/chat long-chat memory", () => {
  it("folds older messages into case facts and a summary, then sends only the newest ones", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(FOLD_REPLY)).mockResolvedValueOnce(reply("Next question."))
    vi.stubGlobal("fetch", fetchMock)
    const messages = history(31)

    const response = await chat({ messages })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { content: string; memory: ConversationMemory } }
    const covered = 22
    expect(body.data.content).toBe("Next question.")
    expect(body.data.memory).toMatchObject({
      covered,
      facts: ["The quiz agent is study-coach", "Exam code: CCA-F"],
      summary: "The user set up a quiz agent.",
    })

    const fold = sent(fetchMock, 0)
    expect(fold.messages[0]?.content).toContain("You keep the memory of a long chat")
    expect(fold.messages.at(-1)?.content).toContain("<user>\nmessage 0\n</user>")
    expect(fold.messages.at(-1)?.content).toContain("message 21")
    expect(fold.messages.at(-1)?.content).not.toContain("message 22")

    const main = sent(fetchMock, 1)
    const turns = main.messages.filter((m) => m.role !== "system")
    expect(turns).toHaveLength(messages.length - covered)
    expect(turns[0]).toMatchObject({ role: "user", content: "message 22" })
    expect(turns.length).toBeGreaterThanOrEqual(KEEP_RECENT_MESSAGES)
    const system = main.messages[0]?.content ?? ""
    expect(system).toContain("## Conversation memory")
    expect(system).toContain("- The quiz agent is study-coach")
    expect(system).toContain("The user set up a quiz agent.")
  })

  it("reuses the browser's memory without a new fold while the recent part is short", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply("ok"))
    vi.stubGlobal("fetch", fetchMock)
    const memory: ConversationMemory = { summary: "Earlier work.", facts: ["Fact A"], covered: 24 }

    const response = await chat({ messages: history(33), memory })
    const body = (await response.json()) as { data: { memory: ConversationMemory } }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body.data.memory).toEqual(memory)
    const main = sent(fetchMock, 0)
    expect(main.messages.filter((m) => m.role !== "system")[0]?.content).toBe("message 24")
    expect(main.messages[0]?.content).toContain("- Fact A")
  })

  it("sends the full history when the fold reply is broken", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply("I cannot do that.")).mockResolvedValueOnce(reply("ok"))
    vi.stubGlobal("fetch", fetchMock)

    const response = await chat({ messages: history(31) })
    const body = (await response.json()) as { data: { memory?: ConversationMemory } }
    expect(body.data.memory).toBeUndefined()
    const main = sent(fetchMock, 1)
    expect(main.messages.filter((m) => m.role !== "system")).toHaveLength(31)
    expect(main.messages[0]?.content).not.toContain("## Conversation memory")
  })

  it("ignores a memory that does not match the history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply("ok"))
    vi.stubGlobal("fetch", fetchMock)

    const response = await chat({ messages: history(3), memory: { summary: "x", facts: [], covered: 10 } })
    const body = (await response.json()) as { data: { memory?: ConversationMemory } }
    expect(body.data.memory).toBeUndefined()
    expect(sent(fetchMock, 0).messages.filter((m) => m.role !== "system")).toHaveLength(3)
  })

  it("rejects a malformed memory", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const response = await chat({ messages: history(3), memory: { summary: "x", facts: "nope", covered: 1 } })
    expect(response.status).toBe(400)
  })

  it("uses the Fast task model for the fold when it is set", async () => {
    await updateAiSettings({ models: { fast: { provider: "openai", model: "gpt-4o-mini" } } })
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(FOLD_REPLY)).mockResolvedValueOnce(reply("ok"))
    vi.stubGlobal("fetch", fetchMock)

    await chat({ messages: history(31) })
    expect(sent(fetchMock, 0).model).toBe("gpt-4o-mini")
    expect(sent(fetchMock, 1).model).toBe("gpt-4o")
  })

  it("streams a folding event and returns the memory with the reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(FOLD_REPLY)).mockResolvedValueOnce(reply("Streamed.")))
    const response = await POST(
      new Request("http://t/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ provider: "openai", model: "gpt-4o", messages: history(31) }),
      })
    )
    const { events } = parseSseFrames(await response.text())
    const names = events.map((e) => e.event)
    expect(names.indexOf("memory_folding")).toBeGreaterThan(-1)
    expect(names.indexOf("memory_folding")).toBeLessThan(names.indexOf("done"))
    expect(events.at(-1)).toMatchObject({ event: "done", data: { content: "Streamed.", memory: { covered: 22 } } })
  })
})
