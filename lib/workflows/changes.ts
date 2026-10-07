import { promises as fs } from "node:fs"
import path from "node:path"

const SKIP_DIRS = new Set([".git", "node_modules", ".next", ".black-agents", "dist", "build", "coverage"])
const MAX_SCANNED = 5_000

/**
 * Workspace files modified after `since` (newest-first, capped). Used as
 * evidence for the schedule preflight — never as a reason to block a run.
 */
export async function filesChangedSince(
  root: string,
  since: string | undefined,
  limit = 50
): Promise<string[]> {
  if (!since) return []
  const sinceMs = Date.parse(since)
  if (Number.isNaN(sinceMs)) return []
  const changed: Array<{ rel: string; mtime: number }> = []
  let scanned = 0

  async function walk(dir: string, prefix: string): Promise<void> {
    if (scanned >= MAX_SCANNED) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (scanned >= MAX_SCANNED) return
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), rel)
        continue
      }
      scanned++
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null)
      if (stat && stat.mtimeMs > sinceMs) changed.push({ rel, mtime: stat.mtimeMs })
    }
  }

  await walk(root, "")
  return changed
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((c) => c.rel)
}
