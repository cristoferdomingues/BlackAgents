import { z } from "zod"

import type { ArtifactType } from "../artifacts/types"
import { findFencedJson, stripFencedBlocks } from "./fenced-json"

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

export type DraftInspection =
  | { kind: "none" }
  | { kind: "ok"; draft: NormalizedDraft }
  | { kind: "invalid"; type: ArtifactType | null; message: string }

function typeHint(value: unknown): ArtifactType | null {
  if (typeof value !== "object" || value === null) return null
  const parsed = draftSchema.shape.type.safeParse((value as { type?: unknown }).type)
  return parsed.success ? parsed.data : null
}

/**
 * Read the first ```artifact block of an assistant message. "invalid" says why
 * a block that is present could not be used, so the chat can show it.
 */
export function inspectDraft(text: string): DraftInspection {
  const block = findFencedJson(text, ARTIFACT_DRAFT_FENCE)
  if (!block) return { kind: "none" }
  if (block.value === undefined) {
    return {
      kind: "invalid",
      type: null,
      message: block.closed
        ? "The draft is not valid JSON."
        : "The draft was cut off before the end.",
    }
  }
  const parsed = draftSchema.safeParse(block.value)
  if (parsed.success) return { kind: "ok", draft: normalizeDraft(parsed.data) }
  const issue = parsed.error.issues[0]
  const field = issue?.path.join(".")
  return {
    kind: "invalid",
    type: typeHint(block.value),
    message: `The draft has a problem${field ? ` in "${field}"` : ""}: ${issue?.message ?? "invalid"}.`,
  }
}

/** The first valid artifact draft in an assistant message, or null. */
export function extractDraft(text: string): NormalizedDraft | null {
  const result = inspectDraft(text)
  return result.kind === "ok" ? result.draft : null
}

/** Remove the ```artifact block from text for cleaner chat rendering. */
export function stripDraftBlock(text: string): string {
  return stripFencedBlocks(text, ARTIFACT_DRAFT_FENCE)
}
