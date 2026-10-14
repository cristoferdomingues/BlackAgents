import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  classifyWorkspaceFileKind,
  composeFilesPrompt,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  parseFileMentions,
  readWorkspaceFile,
  readWorkspaceFileBytes,
  resolveWorkspaceFiles,
  sanitizeOriginalFilename,
  saveWorkspaceFile,
  slugifyFileName,
  updateWorkspaceFileMeta,
  WorkspaceFileError,
} from "@/lib/files"

import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  await env.cleanup()
})

describe("files schema & helpers", () => {
  it("slugifies filenames into valid kebab-case handles", () => {
    expect(slugifyFileName("Invoice_Oct_2026 (Final).pdf")).toBe("invoice-oct-2026-final")
    expect(slugifyFileName("Résumé — Crístofer.docx")).toBe("resume-cristofer")
    expect(slugifyFileName("...")).toBe("file")
  })

  it("sanitizes original filenames and classifies file kinds", () => {
    expect(sanitizeOriginalFilename("../../etc/passwd")).toBe("passwd")
    expect(sanitizeOriginalFilename("meta.json")).toBe("file.bin")
    expect(classifyWorkspaceFileKind("photo.png", "image/png")).toBe("image")
    expect(classifyWorkspaceFileKind("doc.pdf", "application/pdf")).toBe("pdf")
    expect(classifyWorkspaceFileKind("data.csv", "text/csv")).toBe("text")
    expect(classifyWorkspaceFileKind("archive.zip", "application/zip")).toBe("binary")
  })

  it("parses @file:<name> mentions and formats the prompt with absolutePath", () => {
    expect(
      parseFileMentions("Please upload @file:october-invoice and @file:company-logo then check @file:october-invoice.")
    ).toEqual(["october-invoice", "company-logo"])

    const prompt = composeFilesPrompt([
      {
        name: "october-invoice",
        originalName: "Invoice_Oct.pdf",
        mimeType: "application/pdf",
        size: 2048,
        kind: "pdf",
        description: "October expense receipt",
        createdAt: "2026-10-14T10:00:00.000Z",
        updatedAt: "2026-10-14T10:00:00.000Z",
        relativePath: ".black-agents/files/october-invoice/Invoice_Oct.pdf",
        absolutePath: "/tmp/ws/.black-agents/files/october-invoice/Invoice_Oct.pdf",
      },
    ])
    expect(prompt).toContain("browser_file_upload")
    expect(prompt).toContain("/tmp/ws/.black-agents/files/october-invoice/Invoice_Oct.pdf")
    expect(prompt).toContain("October expense receipt")
    expect(composeFilesPrompt([])).toBe("")
  })
})

describe("workspace file store", () => {
  it("saves, deduplicates handles, lists, reads bytes, updates metadata, and deletes files", async () => {
    const first = await saveWorkspaceFile(env.workspace, {
      originalName: "Invoice Oct.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 sample"),
      description: "First invoice",
    })
    expect(first.name).toBe("invoice-oct")
    expect(first.originalName).toBe("Invoice Oct.pdf")
    expect(first.kind).toBe("pdf")
    expect(first.absolutePath).toContain(".black-agents/files/invoice-oct/Invoice Oct.pdf")

    // Uploading another file with the same stem auto-deduplicates the handle
    const second = await saveWorkspaceFile(env.workspace, {
      originalName: "Invoice Oct.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.4 second"),
    })
    expect(second.name).toBe("invoice-oct-2")

    const listed = await listWorkspaceFiles(env.workspace)
    expect(listed.map((f) => f.name).sort()).toEqual(["invoice-oct", "invoice-oct-2"])

    const resolved = await resolveWorkspaceFiles(env.workspace, ["invoice-oct", "missing", "invoice-oct"])
    expect(resolved.map((f) => f.name)).toEqual(["invoice-oct"])

    const loadedBytes = await readWorkspaceFileBytes(env.workspace, "invoice-oct")
    expect(loadedBytes?.bytes.toString("utf8")).toBe("%PDF-1.4 sample")

    const updated = await updateWorkspaceFileMeta(env.workspace, "invoice-oct", {
      name: "october-receipt",
      description: "Updated note",
    })
    expect(updated.name).toBe("october-receipt")
    expect(updated.description).toBe("Updated note")
    expect(await readWorkspaceFile(env.workspace, "invoice-oct")).toBeNull()
    expect((await readWorkspaceFile(env.workspace, "october-receipt"))?.description).toBe("Updated note")

    expect(await deleteWorkspaceFile(env.workspace, "october-receipt")).toBe(true)
    expect(await deleteWorkspaceFile(env.workspace, "october-receipt")).toBe(false)
  })

  it("rejects empty files and duplicate explicit names without overwrite", async () => {
    await expect(
      saveWorkspaceFile(env.workspace, {
        originalName: "empty.txt",
        bytes: new Uint8Array(0),
      })
    ).rejects.toThrow(WorkspaceFileError)

    await saveWorkspaceFile(env.workspace, {
      name: "fixed-handle",
      originalName: "one.txt",
      bytes: new TextEncoder().encode("one"),
    })

    await expect(
      saveWorkspaceFile(env.workspace, {
        name: "fixed-handle",
        originalName: "two.txt",
        bytes: new TextEncoder().encode("two"),
      })
    ).rejects.toThrow(/already exists/)

    const overwritten = await saveWorkspaceFile(env.workspace, {
      name: "fixed-handle",
      originalName: "two.txt",
      bytes: new TextEncoder().encode("two"),
      overwrite: true,
    })
    expect(overwritten.originalName).toBe("two.txt")
  })
})
