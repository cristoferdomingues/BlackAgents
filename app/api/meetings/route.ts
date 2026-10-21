import { fail, handle, ok } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { searchMeetings } from "@/lib/meetings/search"
import { importMeeting, listMeetings, MeetingError } from "@/lib/meetings/store"

export async function GET(req?: Request) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return ok({ meetings: [] })
    const query = req ? (new URL(req.url).searchParams.get("q") ?? "") : ""
    return ok({ meetings: searchMeetings(await listMeetings(currentPath), query) })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    try {
      const meeting = await importMeeting(currentPath, await req.json().catch(() => null))
      return ok(meeting, 201)
    } catch (err) {
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
  })
}
