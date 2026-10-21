import { fail, handle, ok } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { MeetingError, startLiveMeeting } from "@/lib/meetings/store"

export async function POST(req: Request) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    try {
      const meeting = await startLiveMeeting(currentPath, await req.json().catch(() => ({})))
      return ok(meeting, 201)
    } catch (err) {
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
  })
}
