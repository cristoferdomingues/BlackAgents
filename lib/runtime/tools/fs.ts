import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import {
  listDir,
  pathExists,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"

import type { RuntimeTool, ToolOutcome, ToolRisk } from "../types"

export const MAX_READ_BYTES = 100_000
export const MAX_WRITE_BYTES = 500_000
const MAX_LIST_ENTRIES = 500
const HIDDEN_DIRS = new Set([".git", "node_modules", ".next"])

/**
 * Paths that hold agent configuration or app state. Writing there changes how
 * Cursor/Claude or BlackAgents behave, so it is always `exec` risk (approval
 * every time). The brain is only changed through the review inbox.
 */
const PROTECTED_PREFIXES = [".cursor/", ".claude/", ".black-agents/", ".agents/", ".git/"]
const BLOCKED_PREFIXES = [".git/", ".black-agents/brain/", ".black-agents/runs/"]

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

function invalid(error: z.ZodError): ToolOutcome {
  return { error: error.issues[0]?.message ?? "Invalid arguments" }
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

export const fsWriteTool: RuntimeTool = {
  name: "fs_write",
  originalName: "fs_write",
  server: "builtin",
  source: "builtin",
  risk: "write",
  riskFor(args): ToolRisk {
    const raw = typeof args.path === "string" ? args.path : ""
    try {
      return startsWithAny(normalizeRel("/", raw), PROTECTED_PREFIXES) ? "exec" : "write"
    } catch {
      return "exec"
    }
  },
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
