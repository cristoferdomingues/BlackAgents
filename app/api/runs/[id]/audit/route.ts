import { fail, handle, ok } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import {
  auditTypesForGroup,
  readAuditEvents,
  readAuditJsonl,
  type AuditFilterGroup,
  type AuditEventType,
} from "@/lib/workflows/audit"
import { readRun } from "@/lib/workflows/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

const FILTER_GROUPS = new Set<AuditFilterGroup>(["ai", "tools", "approvals", "errors", "lifecycle"])

/** Audit timeline for one run (`events` JSON, or raw `jsonl` download). */
export async function GET(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const run = await readRun(currentPath, id)
    if (!run) return fail("Run not found", 404)

    const url = new URL(req.url)
    if (url.searchParams.get("format") === "jsonl") {
      const body = await readAuditJsonl(currentPath, id)
      return new Response(body, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.events.jsonl"`,
        },
      })
    }

    const stepId = url.searchParams.get("stepId")?.trim() || undefined
    const group = url.searchParams.get("group")?.trim()
    const typeParam = url.searchParams.get("type")?.trim()
    let types: readonly AuditEventType[] | undefined
    if (group) {
      if (!FILTER_GROUPS.has(group as AuditFilterGroup)) {
        return fail("Unknown filter group", 400)
      }
      types = auditTypesForGroup(group as AuditFilterGroup)
    } else if (typeParam) {
      types = typeParam.split(",").map((t) => t.trim()) as AuditEventType[]
    }

    const events = await readAuditEvents(currentPath, id, { stepId, types })
    return ok({ events, runId: id })
  })
}
