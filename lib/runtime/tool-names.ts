import { z } from "zod"

/** Built-in tools an agent can be equipped with. Isomorphic (used by the UI). */
export const BUILTIN_TOOL_NAMES = ["fs_list", "fs_read", "fs_write", "shell_run"] as const
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number]
export const builtinToolNameSchema = z.enum(BUILTIN_TOOL_NAMES)

export function isBuiltinToolName(value: unknown): value is BuiltinToolName {
  return typeof value === "string" && (BUILTIN_TOOL_NAMES as readonly string[]).includes(value)
}

/** Tools an agent gets when its frontmatter does not list `tools`. */
export const DEFAULT_AGENT_TOOLS: BuiltinToolName[] = ["fs_list", "fs_read"]

export const BUILTIN_TOOL_LABELS: Record<BuiltinToolName, { label: string; hint: string }> = {
  fs_list: { label: "List files", hint: "Read-only, inside the workspace" },
  fs_read: { label: "Read files", hint: "Read-only, inside the workspace" },
  fs_write: { label: "Write files", hint: "Needs approval unless writes are allowed" },
  shell_run: { label: "Run commands", hint: "Needs approval for every command" },
}
