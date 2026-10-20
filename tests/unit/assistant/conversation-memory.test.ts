import { describe, expect, it, vi } from "vitest"

import {
  buildFoldPrompt,
  foldConversation,
  MAX_FOLDED_MESSAGE_CHARS,
  parseFoldOutput,
} from "@/lib/assistant/conversation-memory"
import { MAX_FACTS } from "@/lib/chat/memory"
import type { LLMProvider } from "@/lib/llm/types"

function fakeProvider(reply: string | Error): { provider: LLMProvider; generate: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(async () => {
    if (reply instanceof Error) throw reply
    return { content: reply, model: "m" }
  })
  const provider: LLMProvider = {
    id: "openai",
    label: "OpenAI",
    models: [],
    verify: async () => undefined,
    generate,
  }
  return { provider, generate }
}

const VALID = '```conversation-memory\n{ "facts": ["Agent is study-coach", "Exam: CCA-F"], "summary": "User set up a quiz." }\n```'

describe("parseFoldOutput", () => {
  it("reads a valid block", () => {
    expect(parseFoldOutput(VALID)).toEqual({
      facts: ["Agent is study-coach", "Exam: CCA-F"],
      summary: "User set up a quiz.",
    })
  })

  it("rejects missing, broken, or empty-summary output", () => {
    expect(parseFoldOutput("no block here")).toBeNull()
    expect(parseFoldOutput("```conversation-memory\n{ not json\n```")).toBeNull()
    expect(parseFoldOutput('```conversation-memory\n{ "facts": [], "summary": "" }\n```')).toBeNull()
  })

  it("dedupes and caps the facts", () => {
    const facts = [...Array.from({ length: MAX_FACTS + 5 }, (_, i) => `fact ${i}`), "fact 0"]
    const parsed = parseFoldOutput(`\`\`\`conversation-memory\n${JSON.stringify({ facts, summary: "s" })}\n\`\`\``)
    expect(parsed?.facts).toHaveLength(MAX_FACTS)
    expect(new Set(parsed?.facts).size).toBe(MAX_FACTS)
  })
})

describe("buildFoldPrompt", () => {
  it("includes the old memory and quotes the messages, cutting long ones", () => {
    const prompt = buildFoldPrompt(
      { summary: "Old summary.", facts: ["Old fact"], covered: 4 },
      [
        { role: "user", content: "Use study-coach" },
        { role: "assistant", content: "x".repeat(MAX_FOLDED_MESSAGE_CHARS + 50) },
      ]
    )
    expect(prompt).toContain("- Old fact")
    expect(prompt).toContain("Old summary.")
    expect(prompt).toContain("<user>\nUse study-coach\n</user>")
    expect(prompt).toContain("…[cut]")
  })

  it("says none when there is no memory yet", () => {
    expect(buildFoldPrompt(null, [{ role: "user", content: "hi" }])).toContain("Current case facts:\n(none)")
  })
})

describe("foldConversation", () => {
  it("returns the new memory with the covered count", async () => {
    const { provider, generate } = fakeProvider(VALID)
    const memory = await foldConversation({
      provider,
      credentials: { apiKey: "k" },
      model: "fast-model",
      previous: null,
      messages: [{ role: "user", content: "hi" }],
      covered: 10,
    })
    expect(memory).toMatchObject({ covered: 10, facts: ["Agent is study-coach", "Exam: CCA-F"] })
    expect(memory?.updatedAt).toBeDefined()
    const request = generate.mock.calls[0]?.[0] as { model: string; temperature: number; systemContext: string }
    expect(request.model).toBe("fast-model")
    expect(request.temperature).toBe(0)
    expect(request.systemContext).toContain("Never add or guess anything.")
  })

  it("returns null on a bad reply or a provider error, and skips an empty batch", async () => {
    const base = { credentials: { apiKey: "k" }, model: "m", previous: null, covered: 2 }
    expect(await foldConversation({ ...base, provider: fakeProvider("nope").provider, messages: [{ role: "user", content: "a" }] })).toBeNull()
    expect(
      await foldConversation({ ...base, provider: fakeProvider(new Error("down")).provider, messages: [{ role: "user", content: "a" }] })
    ).toBeNull()
    const empty = fakeProvider(VALID)
    expect(await foldConversation({ ...base, provider: empty.provider, messages: [] })).toBeNull()
    expect(empty.generate).not.toHaveBeenCalled()
  })

  it("rethrows when the user stopped the reply", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      foldConversation({
        provider: fakeProvider(new Error("aborted")).provider,
        credentials: { apiKey: "k" },
        model: "m",
        previous: null,
        messages: [{ role: "user", content: "a" }],
        covered: 2,
        signal: controller.signal,
      })
    ).rejects.toThrow("aborted")
  })
})
