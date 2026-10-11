import { afterEach, describe, expect, it, vi } from "vitest"

import { toChatMessage } from "@/lib/assistant/chat-service"
import { anthropicProvider, toAnthropicUserContent } from "@/lib/llm/providers/anthropic"
import { toOpenAIMessages, toOpenAIUserContent } from "@/lib/llm/providers/openai"
import type { BinaryAttachment } from "@/lib/chat/attachments"

const image: BinaryAttachment = { kind: "image", name: "a.png", mimeType: "image/png", data: "aGVsbG8=" }
const pdf: BinaryAttachment = { kind: "pdf", name: "doc.pdf", data: "JVBERi0=" }

afterEach(() => vi.unstubAllGlobals())

describe("OpenAI content parts", () => {
  it("maps text, images and PDFs", () => {
    expect(toOpenAIUserContent("Look", [image, pdf])).toEqual([
      { type: "text", text: "Look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      { type: "file", file: { filename: "doc.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } },
    ])
  })

  it("skips the empty text part", () => {
    expect(toOpenAIUserContent("", [image])).toHaveLength(1)
  })

  it("keeps plain string content for turns without files", () => {
    const messages = toOpenAIMessages({
      model: "m",
      messages: [
        { role: "user", content: "hi" },
        { role: "user", content: "see", attachments: [image] },
      ],
    })
    expect(messages[0]).toEqual({ role: "user", content: "hi" })
    expect(Array.isArray(messages[1].content)).toBe(true)
  })
})

describe("Anthropic content blocks", () => {
  it("maps images and PDFs before the text", () => {
    expect(toAnthropicUserContent("Look", [image, pdf])).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
      {
        type: "document",
        title: "doc.pdf",
        source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
      },
      { type: "text", text: "Look" },
    ])
  })

  it("sends the blocks in the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    })
    vi.stubGlobal("fetch", fetchMock)
    await anthropicProvider.generate(
      { model: "claude", messages: [{ role: "user", content: "read", attachments: [pdf] }] },
      { apiKey: "k" }
    )
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.messages[0].content.map((b) => b.type)).toEqual(["document", "text"])
  })
})

describe("toChatMessage", () => {
  it("inlines text files and keeps binary files as attachments", () => {
    const message = toChatMessage({
      role: "user",
      content: "Summarize",
      attachments: [{ kind: "text", name: "n.md", mimeType: "text/markdown", text: "# Notes" }, image],
    })
    expect(message.content).toContain("Summarize")
    expect(message.content).toContain("# Notes")
    expect(message.attachments).toEqual([image])
  })

  it("ignores attachments on assistant turns", () => {
    const message = toChatMessage({ role: "assistant", content: "hi", attachments: [image] })
    expect(message).toEqual({ role: "assistant", content: "hi" })
  })
})
