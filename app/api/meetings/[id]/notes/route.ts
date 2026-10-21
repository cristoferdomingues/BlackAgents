import { fail, handle, ok } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { getProvider } from "@/lib/llm/registry"
import { ProviderError, type LLMProvider } from "@/lib/llm/types"
import { generateMeetingNotes } from "@/lib/meetings/draft"
import { meetingNotesRequestSchema, type Meeting } from "@/lib/meetings/schema"
import { resolveNotesModel } from "@/lib/meetings/resolve"
import { MeetingError, readMeeting, saveMeeting } from "@/lib/meetings/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const parsed = meetingNotesRequestSchema.safeParse((await req.json().catch(() => ({}))) ?? {})
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)

    let meeting: Meeting | null
    try {
      meeting = await readMeeting(currentPath, (await ctx.params).id)
    } catch (err) {
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
    if (!meeting) return fail("Meeting not found", 404)

    let provider: LLMProvider | undefined
    let secret: Awaited<ReturnType<typeof getVerifiedCredentials>>["secret"] | undefined
    try {
      const choice = await resolveNotesModel(parsed.data)
      provider = getProvider(choice.provider)
      if (!provider) return fail("Unknown provider")
      const verified = await getVerifiedCredentials(provider)
      secret = verified.secret
      const notes = await generateMeetingNotes(provider, verified.credentials, choice.model, meeting)
      return ok(await saveMeeting(currentPath, { ...meeting, notes, status: "ready", error: undefined }))
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not write notes"
      await saveMeeting(currentPath, { ...meeting, status: "failed", error: message.slice(0, 500) }).catch(() => undefined)
      if (err instanceof MeetingError) return fail(err.message, err.status)
      if (err instanceof CredentialStateError) return fail(err.message, err.status)
      if (err instanceof ProviderError) {
        if (provider && secret) await markInvalidOnAuthFailure(provider, err, secret)
        return fail(err.message, err.status)
      }
      throw err
    }
  })
}
