import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { workspaceRoot } from "@/lib/fs-service"
import { findArtifact } from "@/lib/artifacts/parser"
import { serializeArtifact } from "@/lib/artifacts/serializer"
import { artifactInputSchema, nameSchema } from "@/lib/artifacts/schemas"

const previewRequestSchema = z.object({
  input: artifactInputSchema,
  /** Set when editing: the saved artifact's name, so its extra frontmatter is kept. */
  originalName: nameSchema.optional(),
})

/**
 * The exact file Save would write (path + content), without writing it.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = previewRequestSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid artifact")
    }
    const { input, originalName } = parsed.data

    if (!originalName) {
      const { relPath, content } = serializeArtifact(input)
      return ok({ relPath, content })
    }

    const root = await workspaceRoot()
    const existing = await findArtifact(root, input.type, originalName)
    if (!existing) return fail(`Not found: ${input.type}/${originalName}`, 404)
    const { relPath, content } = serializeArtifact(
      { ...input, platform: existing.platform },
      existing.frontmatter
    )
    return ok({ relPath, content })
  })
}
