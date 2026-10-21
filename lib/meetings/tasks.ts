import { workflowSchema, type Workflow } from "@/lib/workflows/schema"

import { slugifyTitle } from "./notes"

export interface MeetingTask {
  task: string
  owner?: string
  due?: string
}

/** A workflow draft for one action item. The user still has to save it. */
export function actionItemWorkflow(item: MeetingTask, agent: string, meetingTitle: string): Workflow {
  const owner = item.owner ? `${item.owner}: ` : ""
  const due = item.due ? ` Due: ${item.due}.` : ""
  const task = `${owner}${item.task}.${due} From the meeting "${meetingTitle}".`.replace(/\s+/g, " ").trim()
  const parsed = workflowSchema.safeParse({
    name: slugifyTitle(item.task),
    description: `Task from ${meetingTitle}`.slice(0, 300),
    task,
    trigger: { type: "manual" },
    steps: [{ id: "do", agent, instructions: task }],
  })
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "This task cannot become a workflow")
  }
  return parsed.data
}
