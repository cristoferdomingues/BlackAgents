import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { workspaceRoot } from "@/lib/fs-service"
import { platformSchema } from "@/lib/artifacts/schemas"
import { exportAll, readExportTargets, writeExportTargets } from "@/lib/artifacts/store"

const bodySchema = z.object({ targets: z.array(platformSchema) })

/** The IDE folders that saves export to. */
export async function GET() {
  return handle(async () => ok(await readExportTargets(await workspaceRoot())))
}

/** Save the targets, then export every source artifact to them. */
export async function PUT(req: Request) {
  return handle(async () => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid targets")
    const root = await workspaceRoot()
    const saved = await writeExportTargets(root, parsed.data.targets)
    const { written } = await exportAll(root)
    return ok({ ...saved, written })
  })
}
