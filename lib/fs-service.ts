import { promises as fs } from "node:fs"
import path from "node:path"

import { expandHome, readConfig } from "./config"
import type { Workspace } from "./artifacts/types"

/**
 * Filesystem access confined to the active workspace root.
 * Every path crossing the API boundary is resolved through `resolveInWorkspace`
 * so it can never escape the selected project directory.
 */

export class WorkspaceError extends Error {}

/** Absolute path of the active workspace, or throw if none is selected. */
export async function workspaceRoot(): Promise<string> {
  const config = await readConfig()
  if (!config.currentPath) {
    throw new WorkspaceError("No workspace selected")
  }
  return config.currentPath
}

export async function currentWorkspace(): Promise<Workspace | null> {
  const config = await readConfig()
  if (!config.currentPath) return null
  return { path: config.currentPath, name: path.basename(config.currentPath) }
}

/** Resolve a workspace-relative path to an absolute path, blocking traversal. */
export function resolveInWorkspace(root: string, relativePath: string): string {
  const normalizedRoot = path.resolve(root)
  const target = path.resolve(normalizedRoot, relativePath)
  const rel = path.relative(normalizedRoot, target)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new WorkspaceError(`Path escapes the workspace: ${relativePath}`)
  }
  return target
}

export interface DirectoryCheck {
  exists: boolean
  isDirectory: boolean
}

/** Validate an arbitrary absolute path the user typed in Settings. */
export async function checkDirectory(inputPath: string): Promise<DirectoryCheck> {
  const abs = path.resolve(expandHome(inputPath))
  try {
    const stat = await fs.stat(abs)
    return { exists: true, isDirectory: stat.isDirectory() }
  } catch {
    return { exists: false, isDirectory: false }
  }
}

export function normalizeWorkspaceInput(inputPath: string): string {
  return path.resolve(expandHome(inputPath.trim()))
}

export async function readText(absPath: string): Promise<string> {
  return fs.readFile(absPath, "utf8")
}

export async function writeText(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, "utf8")
}

export async function removePath(absPath: string): Promise<void> {
  await fs.rm(absPath, { recursive: true, force: true })
}

export async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath)
    return true
  } catch {
    return false
  }
}

export interface DirEntry {
  name: string
  isDirectory: boolean
}

export async function listDir(absDir: string): Promise<DirEntry[]> {
  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true })
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
  } catch {
    return []
  }
}

/** Recursively collect file paths (relative to `absDir`). */
export async function walkFiles(absDir: string): Promise<string[]> {
  const out: string[] = []
  async function recurse(dir: string, prefix: string) {
    const entries = await listDir(dir)
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        await recurse(path.join(dir, entry.name), rel)
      } else {
        out.push(rel)
      }
    }
  }
  await recurse(absDir, "")
  return out
}
