import { z } from "zod"

import { nameSchema } from "../artifacts/schemas"
import { findFencedJson, stripFencedBlocks } from "./fenced-json"

/**
 * A model may propose a memory note, but it cannot save it. The chat card
 * sends a valid draft to the Brain inbox, where a person approves it.
 */

export const MEMORY_DRAFT_FENCE = "memory"

export const memoryDraftSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(120),
  content: z.string().trim().min(1, "content is required").max(500),
  agent: nameSchema.optional(),
})

export type MemoryDraft = z.infer<typeof memoryDraftSchema>

export type MemoryDraftInspection =
  | { kind: "none" }
  | { kind: "ok"; draft: MemoryDraft }
  | { kind: "invalid"; message: string }

/** Read the first memory block and explain invalid model output. */
export function inspectMemoryDraft(text: string): MemoryDraftInspection {
  const block = findFencedJson(text, MEMORY_DRAFT_FENCE)
  if (!block) return { kind: "none" }
  if (block.value === undefined) {
    return {
      kind: "invalid",
      message: block.closed
        ? "The memory draft is not valid JSON."
        : "The memory draft was cut off before the end.",
    }
  }
  const parsed = memoryDraftSchema.safeParse(block.value)
  if (parsed.success) return { kind: "ok", draft: parsed.data }
  const issue = parsed.error.issues[0]
  const field = issue?.path.join(".")
  return {
    kind: "invalid",
    message: `The memory draft has a problem${field ? ` in "${field}"` : ""}: ${issue?.message ?? "invalid"}.`,
  }
}

export function extractMemoryDraft(text: string): MemoryDraft | null {
  const result = inspectMemoryDraft(text)
  return result.kind === "ok" ? result.draft : null
}

/** Remove memory blocks from the prose shown in chat. */
export function stripMemoryBlock(text: string): string {
  return stripFencedBlocks(text, MEMORY_DRAFT_FENCE)
}
