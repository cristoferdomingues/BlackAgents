import { promises as fs } from "node:fs"
import path from "node:path"

import { nameSchema } from "@/lib/artifacts/schemas"
import {
  listDir,
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"

import {
  classifyWorkspaceFileKind,
  FILES_DIR,
  MAX_WORKSPACE_FILE_BYTES,
  sanitizeOriginalFilename,
  slugifyFileName,
  workspaceFileMetaSchema,
  type WorkspaceFile,
  type WorkspaceFileMeta,
  type WorkspaceFileUpdate,
} from "./schema"

const META_FILENAME = "meta.json"

export class WorkspaceFileError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message)
    this.name = "WorkspaceFileError"
  }
}

function fileEntryDirRel(name: string): string {
  return `${FILES_DIR}/${name}`
}

function metaRelPath(name: string): string {
  return `${fileEntryDirRel(name)}/${META_FILENAME}`
}

function contentRelPath(name: string, originalName: string): string {
  return `${fileEntryDirRel(name)}/${originalName}`
}

function toWorkspaceFile(root: string, meta: WorkspaceFileMeta): WorkspaceFile {
  const relativePath = contentRelPath(meta.name, meta.originalName)
  const absolutePath = resolveInWorkspace(root, relativePath)
  return {
    ...meta,
    relativePath,
    absolutePath,
  }
}

export async function readWorkspaceFile(root: string, name: string): Promise<WorkspaceFile | null> {
  if (!nameSchema.safeParse(name).success) return null
  const metaAbs = resolveInWorkspace(root, metaRelPath(name))
  if (!(await pathExists(metaAbs))) return null
  try {
    const raw: unknown = JSON.parse(await readText(metaAbs))
    const parsed = workspaceFileMetaSchema.safeParse(raw)
    if (!parsed.success || parsed.data.name !== name) return null
    const file = toWorkspaceFile(root, parsed.data)
    if (!(await pathExists(file.absolutePath))) return null
    return file
  } catch {
    return null
  }
}

export async function listWorkspaceFiles(root: string): Promise<WorkspaceFile[]> {
  const dirAbs = resolveInWorkspace(root, FILES_DIR)
  const entries = await listDir(dirAbs)
  const out: WorkspaceFile[] = []
  for (const entry of entries) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue
    const file = await readWorkspaceFile(root, entry.name)
    if (file) out.push(file)
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
}

export async function resolveWorkspaceFiles(root: string, names: readonly string[]): Promise<WorkspaceFile[]> {
  const unique = [...new Set(names)]
  const out: WorkspaceFile[] = []
  for (const name of unique) {
    const file = await readWorkspaceFile(root, name)
    if (file) out.push(file)
  }
  return out
}

async function pickAvailableName(root: string, baseSlug: string): Promise<string> {
  const normalized = slugifyFileName(baseSlug)
  let candidate = normalized
  let suffix = 2
  while (await pathExists(resolveInWorkspace(root, fileEntryDirRel(candidate)))) {
    const suffixText = `-${suffix}`
    const stem = normalized.slice(0, Math.max(1, 80 - suffixText.length)).replace(/-+$/g, "")
    candidate = `${stem}${suffixText}`
    suffix++
  }
  return candidate
}

export interface SaveWorkspaceFileInput {
  /** Optional explicit kebab-case handle. If omitted, derived from `originalName` and deduplicated. */
  name?: string
  originalName: string
  mimeType?: string
  bytes: Uint8Array
  description?: string
  /** If true and `name` is explicitly given, overwrite the existing entry with that name. */
  overwrite?: boolean
}

export async function saveWorkspaceFile(
  root: string,
  input: SaveWorkspaceFileInput
): Promise<WorkspaceFile> {
  if (input.bytes.byteLength === 0) {
    throw new WorkspaceFileError("File cannot be empty", 400)
  }
  if (input.bytes.byteLength > MAX_WORKSPACE_FILE_BYTES) {
    throw new WorkspaceFileError("File is too large (max 25 MB)", 400)
  }

  const originalName = sanitizeOriginalFilename(input.originalName)
  const mimeType = input.mimeType?.trim() || "application/octet-stream"
  const description = (input.description ?? "").trim()
  if (description.length > 300) {
    throw new WorkspaceFileError("Description is too long (max 300 characters)", 400)
  }

  let name: string
  if (input.name?.trim()) {
    const parsedName = nameSchema.safeParse(input.name.trim())
    if (!parsedName.success) {
      throw new WorkspaceFileError(parsedName.error.issues[0]?.message ?? "Invalid file name", 400)
    }
    name = parsedName.data
    const existingDir = resolveInWorkspace(root, fileEntryDirRel(name))
    if (await pathExists(existingDir)) {
      if (!input.overwrite) {
        throw new WorkspaceFileError(`A file named "${name}" already exists`, 409)
      }
      await removePath(existingDir)
    }
  } else {
    name = await pickAvailableName(root, originalName)
  }

  const now = new Date().toISOString()
  const meta: WorkspaceFileMeta = {
    name,
    originalName,
    mimeType,
    size: input.bytes.byteLength,
    kind: classifyWorkspaceFileKind(originalName, mimeType),
    description,
    createdAt: now,
    updatedAt: now,
  }

  const validated = workspaceFileMetaSchema.safeParse(meta)
  if (!validated.success) {
    throw new WorkspaceFileError(validated.error.issues[0]?.message ?? "Invalid file metadata", 400)
  }

  const contentAbs = resolveInWorkspace(root, contentRelPath(name, originalName))
  const metaAbs = resolveInWorkspace(root, metaRelPath(name))
  await fs.mkdir(path.dirname(contentAbs), { recursive: true })
  await fs.writeFile(contentAbs, input.bytes)
  await writeText(metaAbs, `${JSON.stringify(validated.data, null, 2)}\n`)

  return toWorkspaceFile(root, validated.data)
}

export async function updateWorkspaceFileMeta(
  root: string,
  name: string,
  patch: WorkspaceFileUpdate
): Promise<WorkspaceFile> {
  const existing = await readWorkspaceFile(root, name)
  if (!existing) {
    throw new WorkspaceFileError(`File "${name}" was not found`, 404)
  }

  const nextName = patch.name?.trim() ? patch.name.trim() : existing.name
  const parsedName = nameSchema.safeParse(nextName)
  if (!parsedName.success) {
    throw new WorkspaceFileError(parsedName.error.issues[0]?.message ?? "Invalid file name", 400)
  }

  const nextDescription =
    patch.description !== undefined ? patch.description.trim() : existing.description
  if (nextDescription.length > 300) {
    throw new WorkspaceFileError("Description is too long (max 300 characters)", 400)
  }

  if (nextName !== existing.name) {
    const targetDir = resolveInWorkspace(root, fileEntryDirRel(nextName))
    if (await pathExists(targetDir)) {
      throw new WorkspaceFileError(`A file named "${nextName}" already exists`, 409)
    }
    const sourceDir = resolveInWorkspace(root, fileEntryDirRel(existing.name))
    await fs.mkdir(path.dirname(targetDir), { recursive: true })
    await fs.rename(sourceDir, targetDir)
  }

  const updatedMeta: WorkspaceFileMeta = {
    name: nextName,
    originalName: existing.originalName,
    mimeType: existing.mimeType,
    size: existing.size,
    kind: existing.kind,
    description: nextDescription,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  }

  await writeText(
    resolveInWorkspace(root, metaRelPath(nextName)),
    `${JSON.stringify(updatedMeta, null, 2)}\n`
  )
  return toWorkspaceFile(root, updatedMeta)
}

export async function deleteWorkspaceFile(root: string, name: string): Promise<boolean> {
  if (!nameSchema.safeParse(name).success) return false
  const dirAbs = resolveInWorkspace(root, fileEntryDirRel(name))
  if (!(await pathExists(dirAbs))) return false
  await removePath(dirAbs)
  return true
}

export async function readWorkspaceFileBytes(
  root: string,
  name: string
): Promise<{ file: WorkspaceFile; bytes: Buffer } | null> {
  const file = await readWorkspaceFile(root, name)
  if (!file) return null
  const bytes = await fs.readFile(file.absolutePath)
  return { file, bytes }
}
