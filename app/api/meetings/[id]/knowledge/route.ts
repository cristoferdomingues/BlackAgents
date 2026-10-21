import { fail, handle, ok } from "@/lib/api-response"
import { ProposalError, proposeConcept } from "@/lib/brain/learn"
import { readConfig } from "@/lib/config"
import { knowledgeFilePath, meetingConceptId, renderMeetingBody } from "@/lib/meetings/notes"
import { MeetingError, readMeeting, saveMeeting } from "@/lib/meetings/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Queue the note in the Brain inbox. Approval is what writes the knowledge file. */
export async function POST(_req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    let meeting
    try {
      meeting = await readMeeting(currentPath, (await ctx.params).id)
    } catch (err) {
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
    if (!meeting) return fail("Meeting not found", 404)
    if (!meeting.notes) return fail("Write the notes first", 400)
    if (meeting.knowledgeProposalId) {
      return ok({
        proposalId: meeting.knowledgeProposalId,
        conceptId: meetingConceptId(meeting),
        file: knowledgeFilePath(meeting),
        already: true,
      })
    }

    try {
      const conceptId = meetingConceptId(meeting)
      const proposal = await proposeConcept(
        currentPath,
        {
          id: conceptId,
          type: "Meeting",
          title: meeting.title,
          description: meeting.notes.summary.slice(0, 500),
          content: renderMeetingBody(meeting, meeting.notes),
          tags: ["meeting", ...(meeting.scope ? [meeting.scope] : [])],
        },
        "meeting"
      )
      await saveMeeting(currentPath, { ...meeting, knowledgeProposalId: proposal.id })
      return ok({ proposalId: proposal.id, conceptId, file: knowledgeFilePath(meeting) }, 201)
    } catch (err) {
      if (err instanceof ProposalError) return fail(err.message, err.status)
      if (err instanceof MeetingError) return fail(err.message, err.status)
      throw err
    }
  })
}
