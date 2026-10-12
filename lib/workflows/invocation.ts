/**
 * Starting a workflow from the chat input. Isomorphic. A message that starts
 * with `/<workflow> input`, `start @workflow:<workflow> input`,
 * `start @<workflow> input` or `@workflow:<workflow> input` names a workflow
 * run instead of a chat turn. Only
 * names of workflows that exist count, so `/name` still loads an artifact
 * when no workflow has that name.
 */

export interface WorkflowInvocation {
  workflow: string
  /** Text after the workflow name: the run's initial data ("" when none). */
  task: string
}

const SLASH_RE = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)([\s\S]*)$/
const START_RE =
  /^(?:start\s+@(?:workflow:)?|@workflow:)([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)([\s\S]*)$/i

export function parseWorkflowInvocation(
  text: string,
  workflowNames: readonly string[]
): WorkflowInvocation | null {
  const trimmed = text.trim()
  const match = SLASH_RE.exec(trimmed) ?? START_RE.exec(trimmed)
  if (!match) return null
  const workflow = match[1]
  if (!workflowNames.includes(workflow)) return null
  return { workflow, task: match[2].trim() }
}

/** The token the mention menu inserts for a workflow. */
export function workflowMentionToken(name: string): string {
  return `@workflow:${name}`
}
