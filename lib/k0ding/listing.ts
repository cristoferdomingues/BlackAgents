import path from "node:path"

import { listDirTyped, pathExists, readBytes, readText, realpathAbs, statFile } from "@/lib/fs-service"

import { K0dingError } from "./errors"
import { compileGitignore, isIgnored } from "./ignore"
import { DEFAULT_HIDDEN_DIRS, K0DING_LIMITS } from "./limits"
import { looksBinary } from "./read-file"
import { resolveExistingInside, resolveInRoot } from "./paths"
import type { CodeRoot, SearchMatch, TreeEntry } from "./schema"
import { isSecretPath } from "./secrets"

const HIDDEN = new Set<string>(DEFAULT_HIDDEN_DIRS)

async function ignoreRules(root: string, extra: readonly string[]): Promise<ReturnType<typeof compileGitignore>> {
  const abs = resolveInRoot(root, ".gitignore")
  const text = (await pathExists(abs)) ? await readText(abs) : ""
  return compileGitignore(`${text}\n${extra.join("\n")}`)
}

function skipped(name: string, rel: string, isDir: boolean, rules: ReturnType<typeof compileGitignore>, showHidden: boolean): boolean {
  if (showHidden) return false
  if (isDir && HIDDEN.has(name)) return true
  return isIgnored(rel, isDir, rules)
}

export async function listCodeTree(root: CodeRoot, dir: string, showHidden: boolean): Promise<TreeEntry[]> {
  const abs = await resolveExistingInside(root.path, dir || ".")
  const stat = await statFile(abs)
  if (!stat.isDirectory) throw new K0dingError("That path is not a folder")
  const rootReal = await realpathAbs(root.path)
  const rules = await ignoreRules(rootReal, root.hidden)
  const entries = await listDirTyped(abs)
  const out: TreeEntry[] = []
  for (const entry of entries) {
    const rel = dir ? `${dir.replace(/\\/g, "/")}/${entry.name}` : entry.name
    let isDir = entry.isDirectory
    if (entry.isSymbolicLink) {
      try {
        const real = await realpathAbs(path.join(abs, entry.name))
        const fromRoot = path.relative(rootReal, real)
        if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) continue
        isDir = (await statFile(real)).isDirectory
      } catch {
        continue
      }
    }
    if (skipped(entry.name, rel, isDir, rules, showHidden)) continue
    out.push({ name: entry.name, path: rel, kind: isDir ? "dir" : "file", secret: isSecretPath(rel) })
    if (out.length >= K0DING_LIMITS.maxListEntries) break
  }
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function walkFiles(
  rootReal: string,
  dirAbs: string,
  dirRel: string,
  rules: ReturnType<typeof compileGitignore>,
  showHidden: boolean,
  visit: (rel: string, abs: string) => Promise<boolean>
): Promise<boolean> {
  let seen = 0
  const queue: Array<{ abs: string; rel: string }> = [{ abs: dirAbs, rel: dirRel }]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    let entries
    try {
      entries = await listDirTyped(current.abs)
    } catch {
      continue
    }
    for (const entry of entries) {
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name
      let isDir = entry.isDirectory
      let abs = path.join(current.abs, entry.name)
      if (entry.isSymbolicLink) {
        try {
          const real = await realpathAbs(abs)
          const fromRoot = path.relative(rootReal, real)
          if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) continue
          isDir = (await statFile(real)).isDirectory
          abs = real
        } catch {
          continue
        }
      }
      if (skipped(entry.name, rel, isDir, rules, showHidden)) continue
      if (isDir) {
        queue.push({ abs, rel })
        continue
      }
      seen += 1
      if (seen > K0DING_LIMITS.maxSearchFiles) return true
      const stop = await visit(rel, abs)
      if (stop) return true
    }
  }
  return false
}

export async function searchCode(
  root: CodeRoot,
  query: string,
  dir = ""
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const needle = query.toLowerCase()
  const rootReal = await realpathAbs(root.path)
  const startAbs = await resolveExistingInside(rootReal, dir || ".")
  const startRel = dir.replace(/\\/g, "/").replace(/\/+$/, "")
  const rules = await ignoreRules(rootReal, root.hidden)
  const matches: SearchMatch[] = []
  const truncated = await walkFiles(rootReal, startAbs, startRel, rules, false, async (rel, abs) => {
    if (isSecretPath(rel) || matches.length >= K0DING_LIMITS.maxSearchMatches) return matches.length >= K0DING_LIMITS.maxSearchMatches
    let stat
    try {
      stat = await statFile(abs)
    } catch {
      return false
    }
    if (!stat.isFile || stat.size > K0DING_LIMITS.maxFileBytes) return false
    const bytes = await readBytes(abs)
    if (looksBinary(bytes)) return false
    const lines = bytes.toString("utf8").split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ""
      if (!line.toLowerCase().includes(needle)) continue
      matches.push({
        path: rel,
        line: i + 1,
        text: line.length > K0DING_LIMITS.maxSearchLineChars ? `${line.slice(0, K0DING_LIMITS.maxSearchLineChars)}…` : line,
      })
      if (matches.length >= K0DING_LIMITS.maxSearchMatches) return true
    }
    return false
  })
  return { matches, truncated }
}

export async function findCodeFiles(root: CodeRoot, query: string): Promise<{ paths: string[]; truncated: boolean }> {
  const needle = query.toLowerCase()
  const rootReal = await realpathAbs(root.path)
  const rules = await ignoreRules(rootReal, root.hidden)
  const paths: string[] = []
  const truncated = await walkFiles(rootReal, rootReal, "", rules, false, async (rel) => {
    if (isSecretPath(rel)) return false
    if (rel.slice(rel.lastIndexOf("/") + 1).toLowerCase().includes(needle)) paths.push(rel)
    return paths.length >= K0DING_LIMITS.maxFindResults
  })
  return { paths, truncated }
}
