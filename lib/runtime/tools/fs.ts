import { promises as fs } from "node:fs"
import path from "node:path"
import fg from "fast-glob"
import { z } from "zod"

import {
  listDir,
  pathExists,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"

import type { RuntimeTool, ToolOutcome, ToolRisk } from "../types"
import { toolArgsError } from "./args"

export const MAX_READ_BYTES = 100_000
export const MAX_WRITE_BYTES = 500_000
const MAX_LIST_ENTRIES = 500
export const MAX_FIND_RESULTS = 1_000
export const MAX_SEARCH_MATCHES = 200
const MAX_SEARCH_FILE_BYTES = 1_000_000
const MAX_SEARCH_LINE_CHARS = 300
const HIDDEN_DIRS = new Set([".git", "node_modules", ".next"])
const FIND_IGNORE = ["**/.git/**", "**/node_modules/**", "**/.next/**", "**/dist/**", "**/.turbo/**", "**/coverage/**"]

/**
 * Paths that hold agent configuration or app state. Writing there changes how
 * Cursor/Claude or BlackAgents behave, so it is always `exec` risk (approval
 * every time). The brain is only changed through the review inbox.
 */
const PROTECTED_PREFIXES = [".cursor/", ".claude/", ".black-agents/", ".agents/", ".git/"]
const BLOCKED_PREFIXES = [".git/", ".black-agents/brain/", ".black-agents/runs/", ".black-agents/files/"]

function normalizeRel(root: string, relPath: string): string {
  const abs = resolveInWorkspace(root, relPath)
  return path.relative(path.resolve(root), abs).split(path.sep).join("/")
}

function startsWithAny(rel: string, prefixes: string[]): boolean {
  const withSlash = rel.endsWith("/") ? rel : `${rel}/`
  return prefixes.some((p) => withSlash.startsWith(p))
}

const listArgs = z.object({ path: z.string().trim().default(".") })
const readArgs = z.object({ path: z.string().trim().min(1) })
const writeArgs = z.object({
  path: z.string().trim().min(1),
  content: z.string().max(MAX_WRITE_BYTES, "Content is too large"),
})
const globSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), "The pattern must stay inside the folder")
const findArgs = z.object({
  pattern: globSchema.default("**/*"),
  path: z.string().trim().default("."),
})
/** Models often send `pattern` (the fs_find name) for the search text. */
function withQueryAlias(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const args = value as Record<string, unknown>
  if (args.query !== undefined || typeof args.pattern !== "string") return args
  const { pattern, ...rest } = args
  return { ...rest, query: pattern }
}

const searchArgs = z.preprocess(withQueryAlias, z.object({
  query: z.string().min(1).max(500),
  path: z.string().trim().default("."),
  glob: globSchema.default("**/*"),
  regex: z.boolean().default(false),
  caseSensitive: z.boolean().default(false),
}))
const editArgs = z.object({
  path: z.string().trim().min(1),
  oldText: z.string().min(1, "oldText is required"),
  newText: z.string().max(MAX_WRITE_BYTES, "newText is too large"),
  replaceAll: z.boolean().default(false),
})

function invalid(error: z.ZodError): ToolOutcome {
  return { error: toolArgsError(error) }
}

export const fsListTool: RuntimeTool = {
  name: "fs_list",
  originalName: "fs_list",
  server: "builtin",
  source: "builtin",
  risk: "read",
  description:
    "List files and folders inside the workspace. `path` is relative to the workspace root.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Folder, relative to the workspace root" } },
  },
  summarize: (args) => `List ${String(args.path ?? ".")}`,
  async execute(args, ctx) {
    const parsed = listArgs.safeParse(args)
    if (!parsed.success) return invalid(parsed.error)
    const abs = resolveInWorkspace(ctx.workspaceRoot, parsed.data.path)
    if (!(await pathExists(abs))) return { error: `Not found: ${parsed.data.path}` }
    const entries = (await listDir(abs))
      .filter((e) => !HIDDEN_DIRS.has(e.name))
      .slice(0, MAX_LIST_ENTRIES)
      .map((e) => (e.isDirectory ? `${e.name}/` : e.name))
    return { result: { path: parsed.data.path, entries } }
  },
}

export const fsReadTool: RuntimeTool = {
  name: "fs_read",
  originalName: "fs_read",
  server: "builtin",
  source: "builtin",
  risk: "read",
  description:
    "Read a UTF-8 text file inside the workspace (first 100 KB). `path` is relative to the workspace root.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  summarize: (args) => `Read ${String(args.path ?? "")}`,
  async execute(args, ctx) {
    const parsed = readArgs.safeParse(args)
    if (!parsed.success) return invalid(parsed.error)
    const rel = normalizeRel(ctx.workspaceRoot, parsed.data.path)
    if (startsWithAny(rel, [".git/"])) return { error: "Reading .git is not allowed" }
    const abs = resolveInWorkspace(ctx.workspaceRoot, rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat?.isFile()) return { error: `Not a file: ${parsed.data.path}` }
    const handle = await fs.open(abs, "r")
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES))
      await handle.read(buffer, 0, buffer.length, 0)
      return {
        result: {
          path: rel,
          content: buffer.toString("utf8"),
          truncated: stat.size > MAX_READ_BYTES,
        },
      }
    } finally {
      await handle.close()
    }
  },
}

/** Files under `path` matching a glob, skipping .git, node_modules and build output. */
async function findFiles(root: string, relDir: string, pattern: string): Promise<string[]> {
  const base = resolveInWorkspace(root, relDir)
  const rootAbs = path.resolve(root)
  const found = await fg(pattern, {
    cwd: base,
    ignore: FIND_IGNORE,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  })
  return found
    .map((rel) => path.relative(rootAbs, path.join(base, rel)).split(path.sep).join("/"))
    .filter((rel) => !rel.startsWith(".."))
    .sort()
}

export const fsFindTool: RuntimeTool = {
  name: "fs_find",
  originalName: "fs_find",
  server: "builtin",
  source: "builtin",
  risk: "read",
  description:
    "Find files recursively by glob pattern, e.g. {\"pattern\":\"**/*.ts\"} or {\"pattern\":\"package.json\",\"path\":\"apps\"}. " +
    "Skips .git, node_modules and build folders. Much faster than calling fs_list folder by folder.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (default **/*)" },
      path: { type: "string", description: "Folder to search, relative to the workspace root" },
    },
  },
  summarize: (args) => `Find ${String(args.pattern ?? "**/*")} in ${String(args.path ?? ".")}`,
  async execute(args, ctx) {
    const parsed = findArgs.safeParse(args)
    if (!parsed.success) return invalid(parsed.error)
    const abs = resolveInWorkspace(ctx.workspaceRoot, parsed.data.path)
    if (!(await pathExists(abs))) return { error: `Not found: ${parsed.data.path}` }
    const files = await findFiles(ctx.workspaceRoot, parsed.data.path, parsed.data.pattern)
    return {
      result: {
        files: files.slice(0, MAX_FIND_RESULTS),
        total: files.length,
        truncated: files.length > MAX_FIND_RESULTS,
      },
    }
  },
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export const fsSearchTool: RuntimeTool = {
  name: "fs_search",
  originalName: "fs_search",
  server: "builtin",
  source: "builtin",
  risk: "read",
  description:
    "Search text inside workspace files and get matching lines with line numbers, e.g. " +
    "{\"query\":\"createClient\",\"glob\":\"**/*.ts\"}. Set regex:true for a regular expression.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      path: { type: "string", description: "Folder to search, relative to the workspace root" },
      glob: { type: "string", description: "Only files matching this glob (default **/*)" },
      regex: { type: "boolean" },
      caseSensitive: { type: "boolean" },
    },
    required: ["query"],
  },
  summarize: (args) => `Search "${String(args.query ?? "")}" in ${String(args.path ?? ".")}`,
  async execute(args, ctx) {
    const parsed = searchArgs.safeParse(args)
    if (!parsed.success) return invalid(parsed.error)
    const { query, regex, caseSensitive } = parsed.data
    let matcher: RegExp
    try {
      matcher = new RegExp(regex ? query : escapeRegExp(query), caseSensitive ? "" : "i")
    } catch {
      return { error: "Invalid regular expression" }
    }
    const abs = resolveInWorkspace(ctx.workspaceRoot, parsed.data.path)
    if (!(await pathExists(abs))) return { error: `Not found: ${parsed.data.path}` }
    const files = await findFiles(ctx.workspaceRoot, parsed.data.path, parsed.data.glob)
    const matches: Array<{ path: string; line: number; text: string }> = []
    let truncated = false
    for (const rel of files) {
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true
        break
      }
      const fileAbs = resolveInWorkspace(ctx.workspaceRoot, rel)
      const stat = await fs.stat(fileAbs).catch(() => null)
      if (!stat?.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) continue
      const content = await fs.readFile(fileAbs, "utf8").catch(() => null)
      if (content === null || content.includes("\u0000")) continue
      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (!matcher.test(lines[i])) continue
        matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, MAX_SEARCH_LINE_CHARS) })
        if (matches.length >= MAX_SEARCH_MATCHES) {
          truncated = true
          break
        }
      }
    }
    return { result: { matches, truncated } }
  },
}

function protectedRisk(args: Record<string, unknown>): ToolRisk {
  const raw = typeof args.path === "string" ? args.path : ""
  try {
    return startsWithAny(normalizeRel("/", raw), PROTECTED_PREFIXES) ? "exec" : "write"
  } catch {
    return "exec"
  }
}

export const fsEditTool: RuntimeTool = {
  name: "fs_edit",
  originalName: "fs_edit",
  server: "builtin",
  source: "builtin",
  risk: "write",
  riskFor: protectedRisk,
  description:
    "Change part of an existing text file: replace `oldText` (exact text, including spaces) with `newText`. " +
    "`oldText` must appear exactly once unless replaceAll is true. Read the file first.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldText: { type: "string", description: "Exact text to replace" },
      newText: { type: "string", description: "Replacement text" },
      replaceAll: { type: "boolean" },
    },
    required: ["path", "oldText", "newText"],
  },
  summarize: (args) => {
    const removed = typeof args.oldText === "string" ? args.oldText.length : 0
    const added = typeof args.newText === "string" ? args.newText.length : 0
    return `Edit ${String(args.path ?? "")} (−${removed} / +${added} chars)`
  },
  async execute(args, ctx) {
    const parsed = editArgs.safeParse(args)
    if (!parsed.success) return invalid(parsed.error)
    const rel = normalizeRel(ctx.workspaceRoot, parsed.data.path)
    if (!rel || rel === ".") return { error: "A file path is required" }
    if (startsWithAny(rel, BLOCKED_PREFIXES)) return { error: `Writing to ${rel} is not allowed` }
    const abs = resolveInWorkspace(ctx.workspaceRoot, rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat?.isFile()) return { error: `Not a file: ${parsed.data.path}. Use fs_write to create it.` }
    const content = await fs.readFile(abs, "utf8")
    const { oldText, newText, replaceAll } = parsed.data
    const count = content.split(oldText).length - 1
    if (count === 0) return { error: "oldText was not found in the file. Read the file and copy the exact text." }
    if (count > 1 && !replaceAll) {
      return { error: `oldText appears ${count} times. Add more surrounding text or set replaceAll.` }
    }
    const next = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, () => newText)
    if (Buffer.byteLength(next) > MAX_WRITE_BYTES) return { error: "The file would be too large" }
    await writeText(abs, next)
    return { result: { path: rel, replacements: replaceAll ? count : 1 } }
  },
}

export const fsWriteTool: RuntimeTool = {
  name: "fs_write",
  originalName: "fs_write",
  server: "builtin",
  source: "builtin",
  risk: "write",
  riskFor: protectedRisk,
  description:
    "Create or overwrite a UTF-8 text file inside the workspace. `path` is relative to the workspace root.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string", description: "The full new file content" },
    },
    required: ["path", "content"],
  },
  summarize: (args) =>
    `Write ${String(args.path ?? "")} (${typeof args.content === "string" ? args.content.length : 0} chars)`,
  async execute(args, ctx) {
    const parsed = writeArgs.safeParse(args)
    if (!parsed.success) return invalid(parsed.error)
    const rel = normalizeRel(ctx.workspaceRoot, parsed.data.path)
    if (!rel || rel === ".") return { error: "A file path is required" }
    if (startsWithAny(rel, BLOCKED_PREFIXES)) {
      return { error: `Writing to ${rel} is not allowed` }
    }
    await writeText(resolveInWorkspace(ctx.workspaceRoot, rel), parsed.data.content)
    return { result: { path: rel, bytes: Buffer.byteLength(parsed.data.content) } }
  },
}
