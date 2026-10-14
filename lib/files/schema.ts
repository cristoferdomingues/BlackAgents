import { z } from "zod"

import { nameSchema } from "@/lib/artifacts/schemas"
import { IMAGE_MIME_TYPES, TEXT_EXTENSIONS } from "@/lib/chat/attachments"

/**
 * Workspace-managed Media / Files library.
 * Stored inside `<workspace>/.black-agents/files/<name>/` with a `meta.json`
 * and the original file on disk so Playwright MCP (`browser_file_upload`) and
 * workflow steps can reference files by handle (`@file:<name>`) while passing
 * the authentic filename and absolute path at runtime.
 */

export const FILES_DIR = ".black-agents/files"
export const MAX_WORKSPACE_FILE_BYTES = 25 * 1024 * 1024
export const MAX_STEP_FILES = 10

export const WORKSPACE_FILE_KINDS = ["image", "pdf", "text", "binary"] as const
export type WorkspaceFileKind = (typeof WORKSPACE_FILE_KINDS)[number]

export const workspaceFileKindSchema = z.enum(WORKSPACE_FILE_KINDS)

const originalNameSchema = z
  .string()
  .trim()
  .min(1, "Filename is required")
  .max(200, "Filename is too long")
  .refine(
    (name) => !name.includes("/") && !name.includes("\\") && name !== "." && name !== ".." && name !== "meta.json",
    "Invalid filename"
  )

export const workspaceFileMetaSchema = z.object({
  name: nameSchema,
  originalName: originalNameSchema,
  mimeType: z.string().trim().min(1).max(120).default("application/octet-stream"),
  size: z.number().int().nonnegative().max(MAX_WORKSPACE_FILE_BYTES, "Files can be at most 25 MB"),
  kind: workspaceFileKindSchema,
  description: z.string().trim().max(300, "Description is too long").default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type WorkspaceFileMeta = z.infer<typeof workspaceFileMetaSchema>

export interface WorkspaceFile extends WorkspaceFileMeta {
  relativePath: string
  absolutePath: string
}

export const workspaceFileUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().max(300, "Description is too long").optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Provide a name or description to update",
  })
export type WorkspaceFileUpdate = z.infer<typeof workspaceFileUpdateSchema>

function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower === "dockerfile") return "dockerfile"
  const dot = lower.lastIndexOf(".")
  return dot === -1 ? "" : lower.slice(dot + 1)
}

/** Classify any file into image, pdf, text, or general binary. */
export function classifyWorkspaceFileKind(originalName: string, mimeType: string): WorkspaceFileKind {
  const type = mimeType.toLowerCase().trim()
  const ext = extensionOf(originalName)
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(type) || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
    return "image"
  }
  if (type === "application/pdf" || ext === "pdf") {
    return "pdf"
  }
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    (TEXT_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    return "text"
  }
  return "binary"
}

/** Sanitize a raw filename so it is safe as a single path segment. */
export function sanitizeOriginalFilename(raw: string): string {
  const base = raw.replace(/^.*[/\\]/, "").trim()
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").slice(0, 180)
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.toLowerCase() === "meta.json") {
    return "file.bin"
  }
  return cleaned
}

/**
 * Turn an arbitrary filename like `My Resume (2026).pdf` into a valid
 * kebab-case handle (`my-resume-2026`).
 */
export function slugifyFileName(filename: string): string {
  const withoutPath = filename.replace(/^.*[/\\]/, "").trim()
  const dot = withoutPath.lastIndexOf(".")
  const stem = dot > 0 ? withoutPath.slice(0, dot) : withoutPath
  const slug = stem
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
  return slug || "file"
}
