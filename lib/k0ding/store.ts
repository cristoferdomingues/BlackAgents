import path from "node:path"

import { projectIdSchema } from "@/lib/artifacts/schemas"
import {
  checkDirectory,
  normalizeWorkspaceInput,
  pathExists,
  readText,
  realpathAbs,
  resolveInWorkspace,
  statFile,
  writeText,
} from "@/lib/fs-service"
import { ensureLocalStateIgnored } from "@/lib/workflows/store"

import { K0dingError } from "./errors"
import { blockedRootReason, slugifyFolder } from "./paths"
import { K0DING_LIMITS } from "./limits"
import {
  codeRootIdSchema,
  codeRootSchema,
  createRootSchema,
  patchRootSchema,
  rootsFileSchema,
  type CodeRoot,
} from "./schema"

export const K0DING_DIR = ".black-agents/k0ding"

export function rootsFileRel(scope?: string): string {
  if (scope && !projectIdSchema.safeParse(scope).success) throw new K0dingError("Invalid project")
  return scope ? `${K0DING_DIR}/${scope}/roots.json` : `${K0DING_DIR}/roots.json`
}

async function readRoots(workspace: string, scope?: string): Promise<CodeRoot[]> {
  const rel = rootsFileRel(scope)
  const abs = resolveInWorkspace(workspace, rel)
  if (!(await pathExists(abs))) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(await readText(abs)) as unknown
  } catch {
    throw new K0dingError("The code folder list is damaged")
  }
  const file = rootsFileSchema.safeParse(parsed)
  if (!file.success) throw new K0dingError("The code folder list is damaged")
  return file.data.roots
}

async function writeRoots(workspace: string, scope: string | undefined, roots: CodeRoot[]): Promise<void> {
  await ensureLocalStateIgnored(workspace)
  const body = rootsFileSchema.parse({ roots })
  await writeText(resolveInWorkspace(workspace, rootsFileRel(scope)), `${JSON.stringify(body, null, 2)}\n`)
}

export async function listCodeRoots(workspace: string, scope?: string): Promise<CodeRoot[]> {
  return readRoots(workspace, scope)
}

export async function readCodeRoot(
  workspace: string,
  scope: string | undefined,
  id: string
): Promise<CodeRoot | null> {
  if (!codeRootIdSchema.safeParse(id).success) throw new K0dingError("Invalid code folder id")
  const roots = await readRoots(workspace, scope)
  return roots.find((root) => root.id === id) ?? null
}

export async function requireCodeRoot(workspace: string, scope: string | undefined, id: string): Promise<CodeRoot> {
  const root = await readCodeRoot(workspace, scope, id)
  if (!root) throw new K0dingError("Code folder not found", 404)
  try {
    const stat = await statFile(root.path)
    if (!stat.isDirectory) throw new K0dingError("That code folder is missing", 404)
  } catch (err) {
    if (err instanceof K0dingError) throw err
    throw new K0dingError("That code folder is missing", 404)
  }
  return root
}

function uniqueId(roots: readonly CodeRoot[], folderName: string): string {
  const base = slugifyFolder(folderName)
  if (!roots.some((root) => root.id === base)) return base
  for (let n = 2; n < 100; n++) {
    const id = `${base}-${n}`.slice(0, 80)
    if (!roots.some((root) => root.id === id)) return id
  }
  throw new K0dingError("Too many folders with that name")
}

export async function addCodeRoot(workspace: string, scope: string | undefined, body: unknown): Promise<CodeRoot> {
  const parsed = createRootSchema.safeParse(body)
  if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Invalid folder")
  const abs = normalizeWorkspaceInput(parsed.data.path)
  const check = await checkDirectory(abs)
  if (!check.exists) throw new K0dingError("That folder does not exist")
  if (!check.isDirectory) throw new K0dingError("Choose a folder, not a file")
  const real = await realpathAbs(abs)
  const blocked = blockedRootReason(real)
  if (blocked) throw new K0dingError(blocked)
  const roots = await readRoots(workspace, scope)
  if (roots.some((root) => root.path === real)) throw new K0dingError("This folder is already open")
  if (roots.length >= K0DING_LIMITS.maxRoots) {
    throw new K0dingError(`You can keep ${K0DING_LIMITS.maxRoots} code folders. Remove one first.`)
  }
  const next = codeRootSchema.parse({
    id: uniqueId(roots, path.basename(real)),
    path: real,
    label: parsed.data.label ?? path.basename(real),
    hidden: [],
  })
  await writeRoots(workspace, scope, [...roots, next])
  return next
}

export async function updateCodeRoot(
  workspace: string,
  scope: string | undefined,
  id: string,
  body: unknown
): Promise<CodeRoot> {
  const parsed = patchRootSchema.safeParse(body)
  if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Invalid update")
  const roots = await readRoots(workspace, scope)
  const index = roots.findIndex((root) => root.id === id)
  const current = roots[index]
  if (!current || index < 0) throw new K0dingError("Code folder not found", 404)
  const nextInput = {
    ...current,
    ...(parsed.data.label ? { label: parsed.data.label } : {}),
    ...(parsed.data.hidden ? { hidden: parsed.data.hidden } : {}),
  }
  if (parsed.data.checkCommand === null) delete nextInput.checkCommand
  else if (parsed.data.checkCommand) nextInput.checkCommand = parsed.data.checkCommand
  const next = codeRootSchema.parse(nextInput)
  const copy = [...roots]
  copy[index] = next
  await writeRoots(workspace, scope, copy)
  return next
}

export async function removeCodeRoot(workspace: string, scope: string | undefined, id: string): Promise<boolean> {
  if (!codeRootIdSchema.safeParse(id).success) throw new K0dingError("Invalid code folder id")
  const roots = await readRoots(workspace, scope)
  const next = roots.filter((root) => root.id !== id)
  if (next.length === roots.length) return false
  await writeRoots(workspace, scope, next)
  return true
}
