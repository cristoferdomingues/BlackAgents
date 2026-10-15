import type { z } from "zod"

/** The first argument problem, naming the field so the model can fix its call. */
export function toolArgsError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "Invalid arguments"
  const field = issue.path.join(".")
  return field ? `\`${field}\`: ${issue.message}` : issue.message
}
