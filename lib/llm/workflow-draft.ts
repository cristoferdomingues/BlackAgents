import { workflowSchema, type Workflow } from "../workflows/schema"
import { findFencedJson, stripFencedBlocks } from "./fenced-json"

/**
 * The workflow draft protocol: one fenced ```workflow block holding a workflow
 * definition. Isomorphic. The draft is checked with the real `workflowSchema`
 * and is only written when the user saves it through /api/workflows.
 */

export const WORKFLOW_DRAFT_FENCE = "workflow"
/** sessionStorage key used to hand a chat draft to the workflow builder. */
export const WORKFLOW_DRAFT_STORAGE_KEY = "black-agents:workflow-draft"

/** First valid workflow draft in a reply, or null (missing block or failed parse). */
export function extractWorkflowDraft(text: string): Workflow | null {
  const block = findFencedJson(text, WORKFLOW_DRAFT_FENCE)
  if (!block || block.value === undefined) return null
  const parsed = workflowSchema.safeParse(block.value)
  return parsed.success ? parsed.data : null
}

export function stripWorkflowBlock(text: string): string {
  return stripFencedBlocks(text, WORKFLOW_DRAFT_FENCE)
}

/** Read a draft handed over from chat (validated again; storage is untrusted). */
export function parseStoredWorkflowDraft(raw: string | null): Workflow | null {
  if (!raw) return null
  try {
    const parsed = workflowSchema.safeParse(JSON.parse(raw) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
