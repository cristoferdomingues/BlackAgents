import { createHash } from "node:crypto"

import {
  listDir,
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"
import { z } from "zod"

/** Workspace-relative cache root for healed / successful browser actions. */
export const BROWSER_CACHE_DIR = ".black-agents/browser-cache"

const MAX_ENTRIES_PER_FLOW = 80

const cacheEntrySchema = z.object({
  intent: z.string(),
  pageSignature: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  updatedAt: z.string().datetime(),
})
export type BrowserCacheEntry = z.infer<typeof cacheEntrySchema>

function sanitizeFlowName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_") || "flow"
}

export function pageSignatureFromSnapshot(snapshot: string, urlHint?: string): string {
  const titleMatch = snapshot.match(/heading\s+[“"']?([^”"'\n]{1,80})/i)
  const linkCount = (snapshot.match(/\blink\b/gi) ?? []).length
  const buttonCount = (snapshot.match(/\bbutton\b/gi) ?? []).length
  const parts = [
    urlHint?.slice(0, 120) ?? "",
    titleMatch?.[1]?.trim() ?? "",
    `links:${linkCount}`,
    `buttons:${buttonCount}`,
    snapshot.slice(0, 200),
  ]
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)
}

export function cacheKey(intent: string, pageSignature: string): string {
  return createHash("sha256")
    .update(`${intent.trim()}\0${pageSignature}`)
    .digest("hex")
    .slice(0, 32)
}

function entryRelPath(flowName: string, key: string): string {
  return `${BROWSER_CACHE_DIR}/${sanitizeFlowName(flowName)}/${key}.json`
}

/** Strip resolved secret values before caching — keep secretId only. */
export function argsForCache(args: Record<string, unknown>): Record<string, unknown> {
  const next = { ...args }
  if (typeof next.secretId === "string" && next.secretId.trim()) {
    delete next.text
    delete next.value
  }
  return next
}

export async function readActionCache(
  workspaceRoot: string,
  flowName: string,
  intent: string,
  pageSignature: string
): Promise<BrowserCacheEntry | null> {
  const key = cacheKey(intent, pageSignature)
  const abs = resolveInWorkspace(workspaceRoot, entryRelPath(flowName, key))
  if (!(await pathExists(abs))) return null
  try {
    const parsed = cacheEntrySchema.safeParse(JSON.parse(await readText(abs)) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function writeActionCache(
  workspaceRoot: string,
  flowName: string,
  entry: Omit<BrowserCacheEntry, "updatedAt"> & { updatedAt?: string }
): Promise<void> {
  const key = cacheKey(entry.intent, entry.pageSignature)
  const rel = entryRelPath(flowName, key)
  const payload: BrowserCacheEntry = cacheEntrySchema.parse({
    ...entry,
    args: argsForCache(entry.args),
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  })
  await writeText(
    resolveInWorkspace(workspaceRoot, rel),
    `${JSON.stringify(payload, null, 2)}\n`
  )
  await pruneFlowCache(workspaceRoot, flowName)
}

async function pruneFlowCache(workspaceRoot: string, flowName: string): Promise<void> {
  const dir = resolveInWorkspace(
    workspaceRoot,
    `${BROWSER_CACHE_DIR}/${sanitizeFlowName(flowName)}`
  )
  if (!(await pathExists(dir))) return
  const entries = (await listDir(dir))
    .filter((e) => !e.isDirectory && e.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (entries.length <= MAX_ENTRIES_PER_FLOW) return
  const excess = entries.slice(0, entries.length - MAX_ENTRIES_PER_FLOW)
  for (const e of excess) {
    await removePath(
      resolveInWorkspace(
        workspaceRoot,
        `${BROWSER_CACHE_DIR}/${sanitizeFlowName(flowName)}/${e.name}`
      )
    )
  }
}
