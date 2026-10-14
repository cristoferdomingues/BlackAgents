import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import {
  listWorkspaceFiles,
  MAX_WORKSPACE_FILE_BYTES,
  saveWorkspaceFile,
  WorkspaceFileError,
} from "@/lib/files"

const jsonUploadSchema = z.object({
  name: z.string().trim().optional(),
  originalName: z.string().trim().min(1, "Filename is required").max(200),
  mimeType: z.string().trim().max(120).optional(),
  /** Base64-encoded file bytes. */
  data: z.string().min(1, "File content is required"),
  description: z.string().trim().max(300).optional(),
  overwrite: z.boolean().optional(),
})

export async function GET() {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return ok({ files: [] })
    const files = await listWorkspaceFiles(currentPath)
    return ok({ files })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)

    const contentType = req.headers.get("content-type") ?? ""
    try {
      if (contentType.includes("multipart/form-data")) {
        const form = await req.formData()
        const entry = form.get("file")
        if (!(entry instanceof File)) {
          return fail("A file is required", 400)
        }
        if (entry.size === 0) {
          return fail("File cannot be empty", 400)
        }
        if (entry.size > MAX_WORKSPACE_FILE_BYTES) {
          return fail("File is too large (max 25 MB)", 400)
        }
        const nameField = form.get("name")
        const descriptionField = form.get("description")
        const overwriteField = form.get("overwrite")
        const bytes = new Uint8Array(await entry.arrayBuffer())
        const file = await saveWorkspaceFile(currentPath, {
          name: typeof nameField === "string" && nameField.trim() ? nameField.trim() : undefined,
          originalName: entry.name,
          mimeType: entry.type || "application/octet-stream",
          bytes,
          description: typeof descriptionField === "string" ? descriptionField : undefined,
          overwrite: overwriteField === "true",
        })
        return ok({ file }, 201)
      }

      const body: unknown = await req.json().catch(() => null)
      const parsed = jsonUploadSchema.safeParse(body)
      if (!parsed.success) {
        return fail(parsed.error.issues[0]?.message ?? "Invalid request body", 400)
      }
      const bytes = Buffer.from(parsed.data.data, "base64")
      const file = await saveWorkspaceFile(currentPath, {
        name: parsed.data.name,
        originalName: parsed.data.originalName,
        mimeType: parsed.data.mimeType,
        bytes,
        description: parsed.data.description,
        overwrite: parsed.data.overwrite,
      })
      return ok({ file }, 201)
    } catch (err) {
      if (err instanceof WorkspaceFileError) {
        return fail(err.message, err.status)
      }
      throw err
    }
  })
}
