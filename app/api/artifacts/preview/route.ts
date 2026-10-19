import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { workspaceRoot } from "@/lib/fs-service"
import { findArtifact } from "@/lib/artifacts/parser"
import { parseScopeParam, resolveScopeParam } from "@/lib/artifacts/scope-request"
import { artifactRelPath } from "@/lib/artifacts/layout"
import { serializeArtifact } from "@/lib/artifacts/serializer"
import { readExportTargets } from "@/lib/artifacts/store"
import { artifactInputSchema, nameSchema } from "@/lib/artifacts/schemas"

const previewRequestSchema = z.object({
  input: artifactInputSchema,
  /** Set when editing: the saved artifact's name, so its extra frontmatter is kept. */
  originalName: nameSchema.optional(),
})

/**
 * The exact file Save would write (path + content), without writing it, and
 * the IDE files it is exported to.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = previewRequestSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid artifact")
    }
    const { input, originalName } = parsed.data
    const config = await readConfig()
    const requested = parseScopeParam(new URL(req.url).searchParams.get("scope"))
    if (!requested.ok) return fail(requested.error, requested.status)
    const needsRoot = Boolean(originalName || requested.scope)
    const root = needsRoot ? (config.currentPath ?? (await workspaceRoot())) : ""
    const scope = requested.scope ? await resolveScopeParam(root, req.url) : requested
    if (!scope.ok) return fail(scope.error, scope.status)
    const targets =
      config.currentPath && !scope.scope ? (await readExportTargets(config.currentPath)).targets : []
    const exports = targets.map((platform) => artifactRelPath(platform, input.type, input.name))

    if (!originalName) {
      const { relPath, content } = serializeArtifact(input, undefined, scope.scope)
      return ok({ relPath, content, exports })
    }

    const existing = await findArtifact(root, input.type, originalName, scope.scope)
    if (!existing) return fail(`Not found: ${input.type}/${originalName}`, 404)
    const { relPath, content } = serializeArtifact(input, existing.frontmatter, scope.scope)
    return ok({ relPath, content, exports })
  })
}
