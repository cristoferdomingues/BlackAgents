import { draftSchema, type ArtifactDraft } from "@/lib/llm/draft"
import { workflowSchema, type Workflow } from "@/lib/workflows/schema"

import { isSecretPath } from "./secrets"
import { k0dingDraftRequestSchema, type CodingSession } from "./schema"

function taskText(session: CodingSession): string {
  return session.prompts.join("\n\n").slice(0, 4_000)
}

function guidanceText(session: CodingSession): string {
  if (session.guidance.length === 0) return "None"
  return session.guidance.map((item) => `${item.type}:${item.name}`).join(", ")
}

export function buildK0dingDraft(
  session: CodingSession,
  body: unknown
): { kind: "skill"; draft: ArtifactDraft } | { kind: "workflow"; workflow: Workflow } {
  const request = k0dingDraftRequestSchema.parse(body)
  const prompts = taskText(session)
  const context = session.context.filter((filePath) => !isSecretPath(filePath)).join(", ") || "None"
  const summary =
    [...session.messages].reverse().find((message) => message.role === "assistant" && message.content.trim())?.content ?? ""

  if (request.kind === "skill") {
    const draft = draftSchema.parse({
      type: "skill",
      name: request.name,
      description: `Reusable coding method from the K0ding session ${request.name}.`,
      body: [
        "# Purpose",
        "",
        prompts || "Repeat this coding task in a new project.",
        "",
        "# Context to inspect",
        "",
        context,
        "",
        "# Guidance",
        "",
        guidanceText(session),
        "",
        "# Method",
        "",
        "1. Inspect the project before changing files.",
        "2. Make the smallest safe change.",
        "3. Run the project checks.",
        "4. Summarize the result and any remaining risk.",
        "",
        summary ? `# Previous result\n\n${summary}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    })
    return { kind: "skill", draft }
  }

  const workflow = workflowSchema.parse({
    name: request.name,
    description: `Reusable coding flow from K0ding session ${request.name}.`,
    task: prompts,
    trigger: { type: "manual" },
    steps: [
      {
        id: "implement",
        agent: request.agent,
        instructions: [
          "Inspect the current workspace and complete the task.",
          `Useful file names from the original session: ${context}.`,
          `Guidance used before: ${guidanceText(session)}.`,
          "Do not assume the original external code folder is available.",
        ].join("\n"),
        input: "task",
        files: [],
        allowWrites: false,
        maxTurns: 20,
        gate: false,
        review: false,
        repair: false,
        login: false,
      },
    ],
  })
  return { kind: "workflow", workflow }
}
