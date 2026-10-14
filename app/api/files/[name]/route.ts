import { NextResponse } from "next/server"

import { ok, fail, handle } from "@/lib/api-response"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"
import {
  deleteWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceFileBytes,
  updateWorkspaceFileMeta,
  WorkspaceFileError,
  workspaceFileUpdateSchema,
} from "@/lib/files"

interface RouteContext {
  params: Promise<{ name: string }>
}

const SAFE_INLINE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
])

export async function GET(req: Request, ctx: RouteContext) {
  const { name } = await ctx.params
  if (!nameSchema.safeParse(name).success) return fail("Invalid file name", 400)

  const url = new URL(req.url)
  const raw = url.searchParams.get("raw") === "1"

  if (raw) {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const loaded = await readWorkspaceFileBytes(currentPath, name)
    if (!loaded) return fail("File not found", 404)
    const contentType = SAFE_INLINE_MIMES.has(loaded.file.mimeType)
      ? loaded.file.mimeType
      : "application/octet-stream"
    const disposition = SAFE_INLINE_MIMES.has(loaded.file.mimeType) ? "inline" : "attachment"
    return new NextResponse(new Uint8Array(loaded.bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(loaded.bytes.byteLength),
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(loaded.file.originalName)}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    })
  }

  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const file = await readWorkspaceFile(currentPath, name)
    if (!file) return fail("File not found", 404)
    return ok({ file })
  })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { name } = await ctx.params
    if (!nameSchema.safeParse(name).success) return fail("Invalid file name", 400)
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)

    const body: unknown = await req.json().catch(() => null)
    const parsed = workspaceFileUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body", 400)
    }

    try {
      const file = await updateWorkspaceFileMeta(currentPath, name, parsed.data)
      return ok({ file })
    } catch (err) {
      if (err instanceof WorkspaceFileError) {
        return fail(err.message, err.status)
      }
      throw err
    }
  })
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { name } = await ctx.params
    if (!nameSchema.safeParse(name).success) return fail("Invalid file name", 400)
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)

    const deleted = await deleteWorkspaceFile(currentPath, name)
    if (!deleted) return fail("File not found", 404)
    return ok({ deleted: true })
  })
}
