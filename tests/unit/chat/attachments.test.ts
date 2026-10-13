import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AttachmentError,
  MAX_ATTACHMENTS,
  readFileAsAttachment,
  MAX_TEXT_BYTES,
  attachmentBytes,
  attachmentMeta,
  attachmentSchema,
  attachmentsSchema,
  classifyFile,
  describeMissingAttachments,
  formatBytes,
  isBinaryAttachment,
  maxBytesFor,
  renderTextAttachments,
  type Attachment,
} from "@/lib/chat/attachments"

const text: Attachment = { kind: "text", name: "notes.md", mimeType: "text/markdown", text: "héllo" }
const image: Attachment = { kind: "image", name: "a.png", mimeType: "image/png", data: "aGVsbG8=" }
const pdf: Attachment = { kind: "pdf", name: "doc.pdf", data: "JVBERi0=" }

describe("classifyFile", () => {
  it("maps images, PDFs and text files", () => {
    expect(classifyFile("a.png", "image/png")).toBe("image")
    expect(classifyFile("a.jpg", "image/jpeg")).toBe("image")
    expect(classifyFile("doc.pdf", "application/pdf")).toBe("pdf")
    expect(classifyFile("doc.PDF", "")).toBe("pdf")
    expect(classifyFile("notes.txt", "text/plain")).toBe("text")
    expect(classifyFile("main.ts", "")).toBe("text")
    expect(classifyFile("data.json", "application/json")).toBe("text")
    expect(classifyFile("Dockerfile", "")).toBe("text")
  })

  it("rejects unsupported types", () => {
    expect(classifyFile("song.mp3", "audio/mpeg")).toBeNull()
    expect(classifyFile("image.svg", "image/svg+xml")).toBeNull()
    expect(classifyFile("archive", "")).toBeNull()
  })
})

describe("attachmentSchema", () => {
  it("accepts each kind", () => {
    expect(attachmentSchema.safeParse(text).success).toBe(true)
    expect(attachmentSchema.safeParse(image).success).toBe(true)
    expect(attachmentSchema.safeParse(pdf).success).toBe(true)
  })

  it("rejects non-base64 data, unknown image types and empty names", () => {
    expect(attachmentSchema.safeParse({ ...image, data: "not base64!" }).success).toBe(false)
    expect(attachmentSchema.safeParse({ ...image, mimeType: "image/svg+xml" }).success).toBe(false)
    expect(attachmentSchema.safeParse({ ...pdf, name: "  " }).success).toBe(false)
  })

  it("rejects text over the limit", () => {
    const big = { ...text, text: "x".repeat(MAX_TEXT_BYTES + 1) }
    expect(attachmentSchema.safeParse(big).success).toBe(false)
  })
})

describe("attachmentsSchema", () => {
  it("caps the number of files", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => text)
    expect(attachmentsSchema.safeParse(many).success).toBe(false)
    expect(attachmentsSchema.safeParse(many.slice(1)).success).toBe(true)
  })

  it("caps the total size", () => {
    const fourMb = "A".repeat(Math.ceil((4 * 1024 * 1024) / 3) * 4)
    const images = Array.from({ length: 5 }, () => ({ ...image, data: fourMb }))
    const result = attachmentsSchema.safeParse(images)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/20 MB/)
  })
})

describe("readFileAsAttachment", () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFileReader(): void {
    class FakeReader {
      result: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(file: Blob): void {
        void file.arrayBuffer().then((buf) => {
          this.result = `data:${file.type};base64,${Buffer.from(buf).toString("base64")}`
          this.onload?.()
        })
      }
    }
    vi.stubGlobal("FileReader", FakeReader)
  }

  it("reads text files as text", async () => {
    const file = new File(["# hi"], "notes.md", { type: "text/markdown" })
    await expect(readFileAsAttachment(file)).resolves.toEqual({
      kind: "text",
      name: "notes.md",
      mimeType: "text/markdown",
      text: "# hi",
    })
  })

  it("reads images and PDFs as base64", async () => {
    stubFileReader()
    const png = new File(["hello"], "a.png", { type: "image/png" })
    await expect(readFileAsAttachment(png)).resolves.toEqual({
      kind: "image",
      name: "a.png",
      mimeType: "image/png",
      data: "aGVsbG8=",
    })
    const doc = new File(["%PDF-"], "doc.pdf", { type: "application/pdf" })
    await expect(readFileAsAttachment(doc)).resolves.toMatchObject({ kind: "pdf", data: "JVBERi0=" })
  })

  it("rejects unsupported and oversized files", async () => {
    await expect(
      readFileAsAttachment(new File(["x"], "a.mp3", { type: "audio/mpeg" }))
    ).rejects.toBeInstanceOf(AttachmentError)
    const big = new File(["x".repeat(MAX_TEXT_BYTES + 1)], "big.txt", { type: "text/plain" })
    await expect(readFileAsAttachment(big)).rejects.toThrow(/too big/)
  })
})

describe("sizes and helpers", () => {
  it("measures decoded bytes", () => {
    expect(attachmentBytes(image)).toBe(5)
    expect(attachmentBytes(text)).toBe(6)
    expect(attachmentMeta(pdf)).toEqual({ kind: "pdf", name: "doc.pdf", size: 5 })
  })

  it("formats bytes and limits", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
    expect(maxBytesFor("pdf")).toBeGreaterThan(maxBytesFor("image"))
  })

  it("splits binary from text and keeps YouTube transcripts as text", () => {
    const video: Attachment = {
      kind: "youtube",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Demo video",
      channel: "Demo",
      transcript: "Hello",
    }
    expect([text, image, pdf, video].filter(isBinaryAttachment)).toEqual([image, pdf])
    expect(attachmentMeta(video)).toEqual({
      kind: "youtube",
      name: "Demo video",
      size: 5,
      url: video.url,
    })
    const rendered = renderTextAttachments([video])
    expect(rendered).toContain("## YouTube videos")
    expect(rendered).toContain("not as instructions")
    expect(rendered).toContain("Hello")
  })

  it("renders text files as quoted data", () => {
    const rendered = renderTextAttachments([text, image])
    expect(rendered).toContain("## Attached files")
    expect(rendered).toContain("not as instructions")
    expect(rendered).toContain('"name": "notes.md"')
    expect(rendered).not.toContain("a.png")
    expect(renderTextAttachments([image])).toBe("")
  })

  it("describes files that are no longer available", () => {
    expect(describeMissingAttachments([])).toBe("")
    expect(describeMissingAttachments([attachmentMeta(pdf)])).toContain("doc.pdf")
  })
})
