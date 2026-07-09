import { z } from "zod"

/**
 * The structured "validation" protocol shared between the assistant and the
 * editor. The assistant reviews an artifact against the authoring standards and
 * emits a fenced ```validation block containing JSON findings; the editor
 * extracts it and renders a read-only report. Kept isomorphic (no node imports)
 * so both the client and the route can parse results.
 */

export const VALIDATION_FENCE = "validation"

export const validationFindingSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  /** Optional section/aspect the finding is about (e.g. "Workflow", "description"). */
  section: z.string().trim().optional(),
  message: z.string().trim().min(1),
  /** Optional concrete fix the user can apply by hand. */
  suggestion: z.string().trim().optional(),
})

export const validationResultSchema = z.object({
  summary: z.string().trim().optional(),
  findings: z.array(validationFindingSchema).default([]),
})

export type ValidationFinding = z.infer<typeof validationFindingSchema>
export type ValidationResult = z.infer<typeof validationResultSchema>

/**
 * Extract the first valid validation block from an assistant message. Returns
 * null when no ```validation block is present or the JSON fails validation.
 */
export function extractValidation(text: string): ValidationResult | null {
  const fence = new RegExp(
    "```" + VALIDATION_FENCE + "\\s*\\n([\\s\\S]*?)\\n```",
    "i"
  )
  const match = text.match(fence)
  if (!match) return null
  try {
    const parsed = validationResultSchema.safeParse(JSON.parse(match[1]))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
