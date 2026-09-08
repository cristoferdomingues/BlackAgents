import path from "node:path"

import { ok, fail, handle } from "@/lib/api-response"
import {
  readConfig,
  addWorkspace,
  setActiveWorkspace,
  removeWorkspace,
  type AppConfig,
} from "@/lib/config"
import {
  checkDirectory,
  normalizeWorkspaceInput,
  scaffoldWorkspace,
} from "@/lib/fs-service"
import { workspaceInputSchema, type WorkspaceInput } from "@/lib/artifacts/schemas"
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

async function parseBody(req: Request): Promise<WorkspaceInput | { error: string }> {
  const json = await req.json().catch(() => null)
  const parsed = workspaceInputSchema.safeParse(json)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid path" }
  }
  return {
    ...parsed.data,
    path: normalizeWorkspaceInput(parsed.data.path),
  }
}

export async function GET() {
  return handle(async () => ok(toState(await readConfig())))
}

/** Add a workspace to the saved list or scaffold a brand-new one from a template. */
export async function POST(req: Request) {
  return handle(async () => {
    const input = await parseBody(req)
    if ("error" in input) return fail(input.error)

    if (input.create) {
      const abs = await scaffoldWorkspace(input.path, input.template)
      return ok(toState(await setActiveWorkspace(abs)), 201)
    }

    const check = await checkDirectory(input.path)
    if (!check.exists) return fail(`Path does not exist: ${input.path}`, 404)
    if (!check.isDirectory) return fail(`Not a directory: ${input.path}`)

    return ok(toState(await addWorkspace(input.path)))
  })
}

/** Switch the active workspace. */
export async function PUT(req: Request) {
  return handle(async () => {
    const input = await parseBody(req)
    if ("error" in input) return fail(input.error)

    const check = await checkDirectory(input.path)
    if (!check.exists) return fail(`Path does not exist: ${input.path}`, 404)
    if (!check.isDirectory) return fail(`Not a directory: ${input.path}`)

    return ok(toState(await setActiveWorkspace(input.path)))
  })
}

/** Remove a workspace from the saved list. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const input = await parseBody(req)
    if ("error" in input) return fail(input.error)
    return ok(toState(await removeWorkspace(input.path)))
  })
}
