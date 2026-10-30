import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { getPendingApproval, resolveApproval } from "@/lib/runtime/approvals"
import { isFileWriteTool } from "@/lib/runtime/tool-names"
import { FILE_WRITE_PERMISSIONS, type FileWritePermission } from "@/lib/runtime/types"

const decisionSchema = z.object({
  approved: z.boolean(),
  remember: z.boolean().optional(),
  fileWritePermission: z.enum(FILE_WRITE_PERMISSIONS).optional(),
  /** Batch card: one boolean per `ApprovalCall.id`. */
  callDecisions: z.record(z.boolean()).optional(),
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
    const fileWriteOnly = pending.calls
      ? pending.calls.length > 0 &&
        pending.calls.every(
          (call) =>
            call.server === "builtin" &&
            isFileWriteTool(call.tool) &&
            call.risk === "write"
        )
      : pending.server === "builtin" &&
        isFileWriteTool(pending.tool) &&
        pending.risk === "write"
    const fileWritePermission: FileWritePermission | undefined =
      parsed.data.approved && pending.scope.kind === "chat" && fileWriteOnly
        ? parsed.data.fileWritePermission
        : undefined
    // A batch card sends one boolean per call; a missing entry follows the
    // card-level decision, so "Approve" with no list still approves the batch.
    const callDecisions = pending.calls
      ? Object.fromEntries(
          pending.calls.map((call) => [
            call.id,
            parsed.data.callDecisions?.[call.id] ?? parsed.data.approved,
          ])
        )
      : undefined
    resolveApproval(id, {
      approved: parsed.data.approved,
      remember,
      ...(fileWritePermission ? { fileWritePermission } : {}),
      ...(callDecisions ? { callDecisions } : {}),
    })
    return ok({
      id,
      approved: parsed.data.approved,
      remember,
      fileWritePermission,
      callDecisions,
    })
  })
}
