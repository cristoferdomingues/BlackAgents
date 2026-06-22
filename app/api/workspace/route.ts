import path from "node:path"

import { ok, fail, handle } from "@/lib/api-response"
import {
  readConfig,
  addWorkspace,
  setActiveWorkspace,
  removeWorkspace,
  type AppConfig,
} from "@/lib/config"
import { checkDirectory, normalizeWorkspaceInput } from "@/lib/fs-service"
import { workspaceInputSchema } from "@/lib/artifacts/schemas"
import type { Workspace } from "@/lib/artifacts/types"

function toWorkspace(p: string): Workspace {
  return { path: p, name: path.basename(p) }
}

function toState(config: AppConfig) {
  return {
    active: config.currentPath ? toWorkspace(config.currentPath) : null,
    workspaces: config.workspaces.map(toWorkspace),
  }
}

async function parseBodyPath(req: Request): Promise<string | { error: string }> {
  const json = await req.json().catch(() => null)
  const parsed = workspaceInputSchema.safeParse(json)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid path" }
  }
  return normalizeWorkspaceInput(parsed.data.path)
}

export async function GET() {
  return handle(async () => ok(toState(await readConfig())))
}

/** Add a workspace to the saved list (validating it is a real directory). */
export async function POST(req: Request) {
  return handle(async () => {
    const result = await parseBodyPath(req)
    if (typeof result !== "string") return fail(result.error)

    const check = await checkDirectory(result)
    if (!check.exists) return fail(`Path does not exist: ${result}`, 404)
    if (!check.isDirectory) return fail(`Not a directory: ${result}`)

    return ok(toState(await addWorkspace(result)))
  })
}

/** Switch the active workspace. */
export async function PUT(req: Request) {
  return handle(async () => {
    const result = await parseBodyPath(req)
    if (typeof result !== "string") return fail(result.error)

    const check = await checkDirectory(result)
    if (!check.exists) return fail(`Path does not exist: ${result}`, 404)
    if (!check.isDirectory) return fail(`Not a directory: ${result}`)

    return ok(toState(await setActiveWorkspace(result)))
  })
}

/** Remove a workspace from the saved list. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const result = await parseBodyPath(req)
    if (typeof result !== "string") return fail(result.error)
    return ok(toState(await removeWorkspace(result)))
  })
}
