import { z } from "zod"

import type { ArtifactType } from "../artifacts/types"

/**
 * The structured artifact "draft" protocol shared between the chat assistant
 * and the editor. The assistant emits a draft inside a fenced ```artifact block
 * containing JSON; the chat UI extracts it and hands it to the editor (no disk
 * write happens until the user saves). Kept isomorphic — no node imports — so
 * both the client and the route can parse drafts.
 */

export const ARTIFACT_DRAFT_FENCE = "artifact"

/** sessionStorage key used to hand a draft from the chat to the editor. */
export const DRAFT_STORAGE_KEY = "black-agents:draft"

export const draftSchema = z.object({
  type: z.enum(["agent", "command", "rule", "skill"]),
  name: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "name must be kebab-case"),
  description: z.string().trim().min(1),
  body: z.string().min(1),
  parallel: z.boolean().optional(),
  alwaysApply: z.boolean().optional(),
  globs: z.array(z.string()).optional(),
})

export type ArtifactDraft = z.infer<typeof draftSchema>

export interface NormalizedDraft {
  type: ArtifactType
  name: string
  description: string
  body: string
  parallel: boolean
  alwaysApply: boolean
  globs: string[]
}

export function normalizeDraft(draft: ArtifactDraft): NormalizedDraft {
  return {
    type: draft.type,
    name: draft.name,
    description: draft.description,
    body: draft.body,
    parallel: draft.parallel ?? false,
    alwaysApply: draft.alwaysApply ?? false,
    globs: draft.globs ?? [],
  }
}

/**
 * Extract the first valid artifact draft from an assistant message. Returns null
 * when no ```artifact block is present or the JSON fails validation.
 */
export function extractDraft(text: string): NormalizedDraft | null {
  const fence = new RegExp(
    "```" + ARTIFACT_DRAFT_FENCE + "\\s*\\n([\\s\\S]*?)\\n```",
    "i"
  )
  const match = text.match(fence)
  if (!match) return null
  try {
    const parsed = draftSchema.safeParse(JSON.parse(match[1]))
    return parsed.success ? normalizeDraft(parsed.data) : null
  } catch {
    return null
  }
}

/** Remove the ```artifact block from text for cleaner chat rendering. */
export function stripDraftBlock(text: string): string {
  const fence = new RegExp(
    "```" + ARTIFACT_DRAFT_FENCE + "\\s*\\n[\\s\\S]*?\\n```",
    "gi"
  )
  return text.replace(fence, "").trim()
}
