import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

import { pathExists, realpathAbs } from "@/lib/fs-service"

import { K0dingError } from "./errors"

const SYSTEM_ROOTS = new Set(
  process.platform === "win32"
    ? ["c:\\windows", "c:\\program files", "c:\\program files (x86)"]
    : [
        "/system",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private",
        "/dev",
        "/opt",
        "/library",
        "/applications",
        "/volumes",
        "/cores",
        "/users",
        "/home",
      ]
)

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex")
}

export function slugifyFolder(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return slug || "project"
}

/** Why this folder cannot be a code root, or null when it is allowed. */
export function blockedRootReason(absPath: string): string | null {
  const resolved = path.resolve(absPath)
  if (resolved === path.parse(resolved).root) return "The disk root cannot be a code folder."
  if (resolved === path.resolve(os.homedir())) {
    return "Your home folder is too large. Open a project folder inside it."
  }
  if (SYSTEM_ROOTS.has(resolved.toLowerCase())) return "System folders cannot be a code folder."
  return null
}

/** Resolve a relative path and reject anything that leaves the code root. */
export function resolveInRoot(root: string, relativePath: string): string {
  if (relativePath.includes("\0")) throw new K0dingError("Invalid path")
  const normalized = relativePath.trim()
  if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new K0dingError("Use a path inside the code folder")
  }
  const rootAbs = path.resolve(root)
  const target = path.resolve(rootAbs, normalized || ".")
  const rel = path.relative(rootAbs, target)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new K0dingError("That path leaves the code folder")
  }
  return target
}

export function toPosixRel(root: string, absPath: string): string {
  const rel = path.relative(path.resolve(root), absPath)
  return rel.split(path.sep).join("/")
}

/**
 * Resolve a path that may not exist yet. The existing parent must stay inside
 * the code root after symlinks are followed.
 */
export async function resolveExistingInside(root: string, relativePath: string): Promise<string> {
  const rootReal = await realpathAbs(root)
  const target = resolveInRoot(rootReal, relativePath)
  const missing: string[] = []
  let current = target
  while (!(await pathExists(current))) {
    const base = path.basename(current)
    const parent = path.dirname(current)
    if (parent === current) throw new K0dingError("Invalid path")
    missing.push(base)
    current = parent
  }
  const real = await realpathAbs(current)
  const rel = path.relative(rootReal, real)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new K0dingError("That path leaves the code folder")
  }
  return path.join(real, ...missing.reverse())
}
