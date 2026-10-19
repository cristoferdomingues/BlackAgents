import { z } from "zod"

/** Built-in tools an agent can be equipped with. Isomorphic (used by the UI). */
export const BUILTIN_TOOL_NAMES = [
  "fs_list",
  "fs_read",
  "fs_find",
  "fs_search",
  "fs_write",
  "fs_edit",
  "shell_run",
  "browser_run_flow",
  "brain_propose_reverification",
] as const
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number]
export const builtinToolNameSchema = z.enum(BUILTIN_TOOL_NAMES)

export function isBuiltinToolName(value: unknown): value is BuiltinToolName {
  return typeof value === "string" && (BUILTIN_TOOL_NAMES as readonly string[]).includes(value)
}

/** Tools an agent gets when its frontmatter does not list `tools`. */
export const DEFAULT_AGENT_TOOLS: BuiltinToolName[] = ["fs_list", "fs_read"]

/** Built-in tools that change workspace files (one approval rule for all). */
export const FILE_WRITE_TOOLS: readonly BuiltinToolName[] = ["fs_write", "fs_edit"]

export function isFileWriteTool(name: string): boolean {
  return (FILE_WRITE_TOOLS as readonly string[]).includes(name)
}

/**
 * Read access brings the search tools and write access brings `fs_edit`, so
 * agents configured before those tools existed get them too.
 */
export function expandBuiltinTools(names: readonly BuiltinToolName[]): BuiltinToolName[] {
  const set = new Set(names)
  if (set.has("fs_list") || set.has("fs_read")) {
    set.add("fs_find")
    set.add("fs_search")
  }
  if (set.has("fs_write")) set.add("fs_edit")
  return BUILTIN_TOOL_NAMES.filter((name) => set.has(name))
}

export const BUILTIN_TOOL_LABELS: Record<BuiltinToolName, { label: string; hint: string }> = {
  fs_list: { label: "List files", hint: "Read-only, inside the workspace" },
  fs_read: { label: "Read files", hint: "Read-only, inside the workspace" },
  fs_find: { label: "Find files", hint: "Read-only. Comes with read access" },
  fs_search: { label: "Search in files", hint: "Read-only. Comes with read access" },
  fs_write: { label: "Write files", hint: "Needs approval unless writes are allowed" },
  fs_edit: { label: "Edit files", hint: "Same approval as Write files. Comes with write access" },
  shell_run: { label: "Run commands", hint: "Needs approval for every command" },
  browser_run_flow: {
    label: "Run browser flow",
    hint: "Replay a saved flow. Turn on Run without asking to skip approval.",
  },
  brain_propose_reverification: {
    label: "Propose knowledge re-verification",
    hint: "Adds a review request to the Brain inbox. It never edits knowledge directly.",
  },
}
