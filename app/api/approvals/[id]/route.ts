import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { getPendingApproval, resolveApproval } from "@/lib/runtime/approvals"
import { FILE_WRITE_PERMISSIONS, type FileWritePermission } from "@/lib/runtime/types"

const decisionSchema = z.object({
  approved: z.boolean(),
  remember: z.boolean().optional(),
  fileWritePermission: z.enum(FILE_WRITE_PERMISSIONS).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Approve or deny one pending tool call. */
export async function POST(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const parsed = decisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision")
    const pending = getPendingApproval(id)
    if (!pending) return fail("This approval is no longer pending", 404)
    const remember = parsed.data.approved && pending.risk === "exec" && Boolean(parsed.data.remember)
    const fileWritePermission: FileWritePermission | undefined =
      parsed.data.approved &&
      pending.scope.kind === "chat" &&
      pending.tool === "fs_write" &&
      pending.risk === "write"
        ? parsed.data.fileWritePermission
        : undefined
    resolveApproval(id, {
      approved: parsed.data.approved,
      remember,
      ...(fileWritePermission ? { fileWritePermission } : {}),
    })
    return ok({ id, approved: parsed.data.approved, remember, fileWritePermission })
  })
}
