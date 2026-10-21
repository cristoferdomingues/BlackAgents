import { fail, handle, ok } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { deleteMeeting, MeetingError, readMeeting } from "@/lib/meetings/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    try {
      const meeting = await readMeeting(currentPath, (await ctx.params).id)
      if (!meeting) return fail("Meeting not found", 404)
      return ok(meeting)
    } catch (err) {
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
  })
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    try {
      const deleted = await deleteMeeting(currentPath, (await ctx.params).id)
      if (!deleted) return fail("Meeting not found", 404)
      return ok({ deleted: true })
    } catch (err) {
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
  })
}
