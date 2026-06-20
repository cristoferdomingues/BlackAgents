import { z } from "zod"

/** kebab-case identifier: lowercase letters, digits, single hyphens. */
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name is too long")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use kebab-case: lowercase letters, digits and single hyphens"
  )

export const artifactTypeSchema = z.enum(["agent", "command", "rule", "skill"])
export const platformSchema = z
  .enum(["cursor", "claude", "windsurf"])
  .default("cursor")

/**
 * Input payload sent by the editor/wizard. Type-specific frontmatter fields
 * (parallel, alwaysApply, globs) ride along in `extra` and are validated +
 * normalized per type by `validateArtifactInput`.
 */
export const artifactInputSchema = z.object({
  type: artifactTypeSchema,
  platform: platformSchema,
  name: nameSchema,
  description: z.string().trim().min(1, "Description is required"),
  body: z.string().default(""),
  extra: z
    .object({
      parallel: z.boolean().optional(),
      alwaysApply: z.boolean().optional(),
      globs: z.array(z.string().trim().min(1)).optional(),
    })
    .partial()
    .default({}),
})

export type ArtifactInput = z.infer<typeof artifactInputSchema>

/** Drop frontmatter fields that don't belong to a given artifact type. */
export function normalizeExtra(
  type: ArtifactInput["type"],
  extra: ArtifactInput["extra"]
): Record<string, unknown> {
  switch (type) {
    case "agent":
      return extra.parallel ? { parallel: true } : {}
    case "rule": {
      const out: Record<string, unknown> = {}
      if (extra.alwaysApply) out.alwaysApply = true
      if (extra.globs && extra.globs.length > 0) out.globs = extra.globs
      return out
    }
    case "command":
    case "skill":
    default:
      return {}
  }
}

export const workspaceInputSchema = z.object({
  path: z.string().trim().min(1, "Path is required"),
})
