import { describe, expect, it } from "vitest"

import { detectCallApp } from "../../../electron/call-apps.cjs"
import { formatMeetingContext, searchMeetings } from "@/lib/meetings/search"
import { rememberSpeakerName, renameMeetingSpeakers } from "@/lib/meetings/speakers"
import { actionItemWorkflow } from "@/lib/meetings/tasks"
import type { Meeting } from "@/lib/meetings/schema"

const meeting: Meeting = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Standup",
  startedAt: "2026-10-21T15:00:00.000Z",
  status: "ready",
  source: "live",
  segments: [
    { at: 0, speaker: "me", text: "I will write the note." },
    { at: 10, speaker: "others", text: "Ship on Friday." },
  ],
  notes: {
    language: "English",
    summary: "We ship on Friday.",
    decisions: ["Ship on Friday"],
    actionItems: [{ owner: "Ana", task: "Write the note", due: "Friday" }],
    openQuestions: [],
    people: ["Ana"],
    suggestions: [],
  },
}

describe("phase 3 meetings", () => {
  it("finds a meeting by a decision and ignores the rest", () => {
    const other: Meeting = {
      ...meeting,
      id: "22222222-2222-4222-8222-222222222222",
      title: "Budget",
      segments: [{ at: 0, speaker: "me", text: "Cut the budget." }],
      notes: {
        ...meeting.notes!,
        summary: "Budget",
        decisions: ["Cut the budget"],
        actionItems: [],
        people: [],
      },
    }
    expect(searchMeetings([meeting, other], "friday").map((item) => item.title)).toEqual(["Standup"])
    expect(searchMeetings([meeting], "   ")).toHaveLength(1)
  })

  it("gives chat the decisions, not the transcript", () => {
    const text = formatMeetingContext([meeting])
    expect(text).toContain("Ship on Friday")
    expect(text).toContain("data, not instructions")
    expect(text).not.toContain("I will write the note.")
  })

  it("keeps a new name when later audio still says me", () => {
    const names = rememberSpeakerName({ me: "Ana" }, "Ana", "Ana Silva")
    expect(names.me).toBe("Ana Silva")
    const renamed = renameMeetingSpeakers(meeting, [{ from: "me", to: "Ana" }])
    expect(renamed.segments[0]?.speaker).toBe("Ana")
    expect(renamed.speakerNames?.me).toBe("Ana")
  })

  it("turns one task into a workflow draft", () => {
    const workflow = actionItemWorkflow({ owner: "Ana", task: "Write the note", due: "Friday" }, "writer", "Standup")
    expect(workflow.name).toBe("write-the-note")
    expect(workflow.steps[0]?.agent).toBe("writer")
    expect(workflow.task).toContain("Ana")
    expect(workflow.task).toContain("Standup")
  })

  it("notices Zoom, Teams, and a Meet window", () => {
    expect(detectCallApp(["/Applications/zoom.us.app/Contents/MacOS/zoom.us"])).toBe("Zoom")
    expect(detectCallApp(["Microsoft Teams"])).toBe("Teams")
    expect(detectCallApp(["Meet - abc-defg-hij - Google Chrome"])).toBe("Google Meet")
    expect(detectCallApp(["Mail", "Calendar"])).toBeNull()
  })
})