import path from "node:path"

import { ok, fail, handle } from "@/lib/api-response"
import { readConfig, setCurrentWorkspace, removeRecent } from "@/lib/config"
import { checkDirectory, normalizeWorkspaceInput } from "@/lib/fs-service"
import { workspaceInputSchema } from "@/lib/artifacts/schemas"
import type { Workspace } from "@/lib/artifacts/types"

function toWorkspace(p: string): Workspace {
  return { path: p, name: path.basename(p) }
}

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    return ok({
      workspace: config.currentPath ? toWorkspace(config.currentPath) : null,
      recents: config.recents.map(toWorkspace),
    })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = workspaceInputSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid path")
    }

    const abs = normalizeWorkspaceInput(parsed.data.path)
    const check = await checkDirectory(abs)
    if (!check.exists) return fail(`Path does not exist: ${abs}`, 404)
    if (!check.isDirectory) return fail(`Not a directory: ${abs}`)

    const config = await setCurrentWorkspace(abs)
    return ok({
      workspace: toWorkspace(abs),
      recents: config.recents.map(toWorkspace),
    })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const json = await req.json().catch(() => null)
    const parsed = workspaceInputSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid path")
    }
    const config = await removeRecent(normalizeWorkspaceInput(parsed.data.path))
    return ok({
      workspace: config.currentPath ? toWorkspace(config.currentPath) : null,
      recents: config.recents.map(toWorkspace),
    })
  })
}
