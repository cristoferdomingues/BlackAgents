import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { workspaceRoot } from "@/lib/fs-service"
import { artifactTypeSchema, platformSchema } from "@/lib/artifacts/schemas"
import { ArtifactStoreError, exportAll, importArtifacts } from "@/lib/artifacts/store"

const bodySchema = z.discriminatedUnion("action", [
  /** Write source artifacts (all, or the given ids) to the IDE targets. */
  z.object({ action: z.literal("export"), ids: z.array(z.string()).optional() }),
  /** Move IDE-only artifacts into the source, or take one IDE copy. */
  z.object({
    action: z.literal("import"),
    only: z
      .object({ platform: platformSchema, type: artifactTypeSchema, name: z.string().min(1) })
      .optional(),
  }),
])

export async function POST(req: Request) {
  return handle(async () => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request")
    const root = await workspaceRoot()
    if (parsed.data.action === "export") return ok(await exportAll(root, parsed.data.ids))
    try {
      return ok(await importArtifacts(root, parsed.data.only))
    } catch (err) {
      if (err instanceof ArtifactStoreError) return fail(err.message, err.status)
      throw err
    }
  })
}
