import { z } from "zod"

import { findFencedJson, stripFencedBlocks } from "./fenced-json"

/**
 * A model may propose knowledge, but it cannot save or verify it. The chat UI
 * sends a valid draft to the Brain inbox, where a person reviews it.
 */

export const KNOWLEDGE_DRAFT_FENCE = "knowledge"

const conceptIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/,
    "id must use kebab-case path segments"
  )

const sourceSchema = z.object({
  resource: z.string().trim().min(1, "source resource is required"),
  title: z.string().trim().min(1).optional(),
})

export const knowledgeDraftSchema = z.object({
  id: conceptIdSchema,
  type: z.string().trim().min(1, "type is required"),
  title: z.string().trim().min(1, "title is required").max(200),
  description: z.string().trim().min(1, "description is required").max(500),
  body: z.string().trim().min(1, "body is required").max(20_000),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  sources: z.array(sourceSchema).max(20).optional(),
})

export type KnowledgeDraft = z.infer<typeof knowledgeDraftSchema>

export type KnowledgeDraftInspection =
  | { kind: "none" }
  | { kind: "ok"; draft: KnowledgeDraft }
  | { kind: "invalid"; message: string }

/** Read the first knowledge block and explain invalid model output. */
export function inspectKnowledgeDraft(text: string): KnowledgeDraftInspection {
  const block = findFencedJson(text, KNOWLEDGE_DRAFT_FENCE)
  if (!block) return { kind: "none" }
  if (block.value === undefined) {
    return {
      kind: "invalid",
      message: block.closed
        ? "The knowledge draft is not valid JSON."
        : "The knowledge draft was cut off before the end.",
    }
  }
  const parsed = knowledgeDraftSchema.safeParse(block.value)
  if (parsed.success) return { kind: "ok", draft: parsed.data }
  const issue = parsed.error.issues[0]
  const field = issue?.path.join(".")
  return {
    kind: "invalid",
    message: `The knowledge draft has a problem${field ? ` in "${field}"` : ""}: ${issue?.message ?? "invalid"}.`,
  }
}

export function extractKnowledgeDraft(text: string): KnowledgeDraft | null {
  const result = inspectKnowledgeDraft(text)
  return result.kind === "ok" ? result.draft : null
}

/** Remove knowledge blocks from the prose shown in chat. */
export function stripKnowledgeBlock(text: string): string {
  return stripFencedBlocks(text, KNOWLEDGE_DRAFT_FENCE)
}
