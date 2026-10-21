import { pathExists, readText, removePath, statFile, writeText } from "@/lib/fs-service"

import { K0dingError } from "./errors"
import { K0DING_LIMITS } from "./limits"
import { resolveExistingInside, sha256 } from "./paths"
import type { SessionStatus, StagedChange } from "./schema"
import { isSecretPath } from "./secrets"

export function pendingChange(changes: readonly StagedChange[], filePath: string): StagedChange | undefined {
  return changes.find((change) => change.path === filePath && change.state === "pending")
}

export function setPending(changes: readonly StagedChange[], next: StagedChange): StagedChange[] {
  return [...changes.filter((change) => !(change.path === next.path && change.state === "pending")), next]
}

export function dropPending(changes: readonly StagedChange[], filePath: string): StagedChange[] {
  return changes.filter((change) => !(change.path === filePath && change.state === "pending"))
}

/** Replace `oldText` once. More than one match is refused so the edit stays exact. */
export function replaceOnce(
  source: string,
  oldText: string,
  newText: string
): { ok: true; content: string } | { ok: false; error: string } {
  if (!oldText) return { ok: false, error: "oldText is required" }
  const first = source.indexOf(oldText)
  if (first < 0) return { ok: false, error: "That text was not found. Read the file and copy the exact block." }
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    return { ok: false, error: "That text appears more than once. Include more lines so it matches once." }
  }
  const content = `${source.slice(0, first)}${newText}${source.slice(first + oldText.length)}`
  if (Buffer.byteLength(content) > K0DING_LIMITS.maxFileBytes) {
    return { ok: false, error: "The file would be over 1 MB. Split the change." }
  }
  return { ok: true, content }
}

export function statusAfter(changes: readonly StagedChange[]): SessionStatus {
  if (changes.some((change) => change.state === "pending" || change.state === "conflict")) return "review"
  if (changes.some((change) => change.state === "applied")) return "applied"
  return "discarded"
}

async function diskHash(abs: string): Promise<string | null> {
  if (!(await pathExists(abs))) return null
  const stat = await statFile(abs)
  if (!stat.isFile) return null
  return sha256(await readText(abs))
}

function refuseProtected(filePath: string): void {
  if (isSecretPath(filePath)) throw new K0dingError("Secret files are not written")
  if (filePath.split("/").includes(".git")) throw new K0dingError("Git files are not written")
}

async function applyOne(root: string, change: StagedChange): Promise<StagedChange> {
  refuseProtected(change.path)
  const abs = await resolveExistingInside(root, change.path)
  const current = await diskHash(abs)
  if (change.kind === "delete") {
    if (change.baseHash && current !== change.baseHash) return { ...change, state: "conflict" }
    if (current === null) return { ...change, state: "applied" }
    await removePath(abs)
    return { ...change, state: "applied" }
  }
  if (change.content === undefined) throw new K0dingError(`No content staged for ${change.path}`)
  if (Buffer.byteLength(change.content) > K0DING_LIMITS.maxFileBytes) {
    throw new K0dingError("That file is over 1 MB. Split the change.")
  }
  if (change.kind === "create" && current !== null) return { ...change, state: "conflict" }
  if (change.kind === "update" && current !== (change.baseHash ?? null)) return { ...change, state: "conflict" }
  await writeText(abs, change.content)
  return { ...change, state: "applied" }
}

export async function applyChanges(
  root: string,
  changes: readonly StagedChange[],
  paths: readonly string[]
): Promise<StagedChange[]> {
  const wanted = new Set(paths)
  const next: StagedChange[] = []
  for (const change of changes) {
    if (!wanted.has(change.path) || change.state !== "pending") {
      next.push(change)
      continue
    }
    next.push(await applyOne(root, change))
  }
  return next
}

export function discardChanges(changes: readonly StagedChange[], paths: readonly string[]): StagedChange[] {
  const wanted = new Set(paths)
  return changes.map((change) =>
    wanted.has(change.path) && change.state === "pending" ? { ...change, state: "discarded" as const } : change
  )
}
