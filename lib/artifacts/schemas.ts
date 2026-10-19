import { z } from "zod"

import { inspectModelRef, isAgentModelAlias, parseModelRef, providerIdSchema } from "../llm/model-ref"
import { builtinToolNameSchema } from "../runtime/tool-names"

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
  .enum(["cursor", "claude", "windsurf", "antigravity"])
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
      /** Agents: built-in tools (fs_list, fs_read, fs_write, shell_run, browser_run_flow). */
      tools: z.array(builtinToolNameSchema).optional(),
      /** Agents: MCP servers the agent may use (absent = all). */
      mcpServers: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
      /** Agents: model id, "inherit", an alias, or "task:<kind>". `null` clears it. */
      model: z.string().trim().max(200, "Model id is too long").nullable().optional(),
      /** Agents: provider for `model`. `null` clears it. Absent = the caller's provider. */
      provider: providerIdSchema.nullable().optional(),
    })
    .partial()
    .default({}),
})
.superRefine((input, ctx) => {
  if (input.type !== "agent") return
  const model = input.extra.model
  const provider = input.extra.provider
  if (model == null && (provider == null || provider === undefined)) return
  const inspected = inspectModelRef(model === null ? undefined : model, provider === null ? undefined : provider)
  if (!inspected.error) return
  ctx.addIssue({
    code: "custom",
    path: ["extra", "model"],
    message: inspected.error.message,
  })
})

export type ArtifactInput = z.infer<typeof artifactInputSchema>

/** Drop frontmatter fields that don't belong to a given artifact type. */
export function normalizeExtra(
  type: ArtifactInput["type"],
  extra: ArtifactInput["extra"]
): Record<string, unknown> {
  switch (type) {
    case "agent": {
      const out: Record<string, unknown> = {}
      if (extra.parallel) out.parallel = true
      if (extra.tools) out.tools = [...new Set(extra.tools)]
      if (extra.mcpServers && extra.mcpServers.length > 0) {
        out.mcpServers = [...new Set(extra.mcpServers)]
      }
      if (typeof extra.model === "string") {
        const model = extra.model.trim()
        if (model && model !== "inherit") {
          if (isAgentModelAlias(model)) {
            out.model = model
          } else {
            try {
              const ref = parseModelRef(model, extra.provider ?? undefined)
              if (ref.kind === "id") {
                out.model = ref.model
                if (ref.provider) out.provider = ref.provider
              } else if (ref.kind === "task") {
                out.model = `task:${ref.task}`
              }
            } catch {
              // Schema validation already rejects bad values.
            }
          }
        }
      }
      return out
    }
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

export const workspaceTemplateSchema = z.enum(["blank", "crypto", "software"])
export type WorkspaceTemplate = z.infer<typeof workspaceTemplateSchema>

export const workspaceInputSchema = z.object({
  path: z.string().trim().min(1, "Path is required"),
  create: z.boolean().optional(),
  template: workspaceTemplateSchema.optional().default("blank"),
})
export type WorkspaceInput = z.infer<typeof workspaceInputSchema>

/**
 * Project scopes — one-level sub-scopes under `.black-agents/projects/<id>/`.
 * See the `project-scopes` skill: the manifest whitelist is the ONLY way a
 * project gains access to parent workspace services (fail closed).
 */

/** Closed set of inheritable workspace services. Everything else never inherits. */
export const scopeTokenSchema = z.enum([
  "mcp",
  "skills",
  "rules",
  "commands",
  "agents",
  "workflows",
  "knowledge",
])
export type ScopeToken = z.infer<typeof scopeTokenSchema>

/** One-level folder id: kebab-case, single segment, no traversal. */
export const projectIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Project id must be a kebab-case folder name"
  )

export const projectManifestSchema = z.object({
  /** Must equal the containing folder name (checked by the loader). */
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  /** Whitelisted workspace tokens to inherit. Absent/empty = inherit nothing. */
  inherits: z.array(scopeTokenSchema).default([]),
  createdAt: z.string().trim().min(1).optional(),
})
export type ProjectManifest = z.infer<typeof projectManifestSchema>

/** Payload for POST/PATCH /api/projects (createdAt is server-owned). */
export const projectInputSchema = z.object({
  id: projectIdSchema,
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  inherits: z.array(scopeTokenSchema).default([]),
})
export type ProjectInput = z.infer<typeof projectInputSchema>

/** PATCH /api/projects/[id]: id stays fixed (it is the folder name). */
export const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  inherits: z.array(scopeTokenSchema).optional(),
})
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>
