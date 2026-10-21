import { fail, handle, ok } from "@/lib/api-response"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { readConfig } from "@/lib/config"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { getProvider } from "@/lib/llm/registry"
import { ProviderError, type LLMProvider } from "@/lib/llm/types"
import { generateMeetingBuild } from "@/lib/meetings/draft"
import { resolveNotesModel } from "@/lib/meetings/resolve"
import { meetingBuildRequestSchema } from "@/lib/meetings/schema"
import { MeetingError, readMeeting } from "@/lib/meetings/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Draft an artifact or a workflow. The editor saves it after the user reviews it. */
export async function POST(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const parsed = meetingBuildRequestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)

    let meeting
    try {
      meeting = await readMeeting(currentPath, (await ctx.params).id)
    } catch (err) {
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
    if (!meeting) return fail("Meeting not found", 404)
    const match = meeting.notes?.suggestions.some(
      (item) => item.kind === parsed.data.kind && item.name === parsed.data.name
    )
    if (!match) return fail("That idea is not in the meeting notes", 400)
    if (parsed.data.kind === "workflow") {
      const agents = (await scanWorkspace(currentPath, meeting.scope)).filter((item) => item.type === "agent")
      if (agents.length === 0) return fail("Add an agent first. A workflow needs an agent for each step.", 400)
    }

    let provider: LLMProvider | undefined
    let secret: Awaited<ReturnType<typeof getVerifiedCredentials>>["secret"] | undefined
    try {
      const choice = await resolveNotesModel(parsed.data)
      provider = getProvider(choice.provider)
      if (!provider) return fail("Unknown provider")
      const verified = await getVerifiedCredentials(provider)
      secret = verified.secret
      const built = await generateMeetingBuild(provider, verified.credentials, choice.model, meeting, parsed.data)
      return ok(built)
    } catch (err) {
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
