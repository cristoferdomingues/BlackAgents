import { runProcess } from "@/lib/runtime/tools/shell"

import { K0dingError } from "./errors"
import { resolveExistingInside } from "./paths"

export interface GitStatus {
  git: boolean
  paths: string[]
}

/** Parse `git status --porcelain -z`. A rename includes the old path and the new path. */
export function parsePorcelain(text: string): string[] {
  const records = text.split("\0")
  const paths: string[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index] ?? ""
    if (record.length < 4) continue
    const code = record.slice(0, 2)
    const file = record.slice(3)
    const renamed = code.includes("R") || code.includes("C")
    if (file) paths.push(file)
    if (renamed) {
      const dest = records[index + 1]
      if (dest) paths.push(dest)
      index += 1
    }
  }
  return [...new Set(paths)]
}

export async function gitStatus(root: string): Promise<GitStatus> {
  const result = await runProcess("git", ["status", "--porcelain", "-z"], {
    cwd: root,
    timeoutMs: 15_000,
    shell: false,
  })
  if (result.exitCode !== 0) return { git: false, paths: [] }
  return { git: true, paths: parsePorcelain(result.stdout) }
}

export async function gitDiff(root: string, relativePath: string): Promise<{ diff: string }> {
  await resolveExistingInside(root, relativePath)
  const tracked = await runProcess("git", ["diff", "--", relativePath], {
    cwd: root,
    timeoutMs: 15_000,
    shell: false,
  })
  if (tracked.exitCode !== 0 && tracked.exitCode !== 1) {
    throw new K0dingError(tracked.stderr.trim() || "Git diff failed")
  }
  if (tracked.stdout.trim()) return { diff: tracked.stdout }
  const untracked = await runProcess("git", ["diff", "--no-index", "--", "/dev/null", relativePath], {
    cwd: root,
    timeoutMs: 15_000,
    shell: false,
  })
  return { diff: untracked.stdout || "No git changes in this file." }
}
