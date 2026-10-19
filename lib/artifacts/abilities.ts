import {
  BUILTIN_TOOL_NAMES,
  expandBuiltinTools,
  type BuiltinToolName,
} from "../runtime/tool-names"

/**
 * Agent abilities as a few clear levels instead of one switch per tool.
 * Isomorphic: the editor shows them and tests cover the mapping.
 */

export type AbilityLevel = "read" | "write" | "full"
export type AbilityChoice = AbilityLevel | "custom"
export type AbilityRisk = "low" | "medium" | "high"

export interface AbilityLevelSpec {
  label: string
  summary: string
  risk: AbilityRisk
  tools: BuiltinToolName[]
}

export const ABILITY_LEVELS: Record<AbilityLevel, AbilityLevelSpec> = {
  read: {
    label: "Read only",
    summary: "Looks at and searches files. Never changes anything.",
    risk: "low",
    tools: ["fs_list", "fs_read"],
  },
  write: {
    label: "Read and write",
    summary: "Can also create and edit files. Each write asks you first, unless writes are allowed.",
    risk: "medium",
    tools: ["fs_list", "fs_read", "fs_write"],
  },
  full: {
    label: "Full",
    summary: "Can also run terminal commands (install, test, build). Every command asks you first.",
    risk: "high",
    tools: ["fs_list", "fs_read", "fs_write", "shell_run"],
  },
}

export const ABILITY_LEVEL_ORDER: AbilityLevel[] = ["read", "write", "full"]

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item))
}

/** The level whose tools match exactly (after included tools), else "custom". */
export function abilityChoiceOf(tools: readonly BuiltinToolName[]): AbilityChoice {
  const expanded = expandBuiltinTools(tools)
  for (const level of ABILITY_LEVEL_ORDER) {
    if (sameSet(expanded, expandBuiltinTools(ABILITY_LEVELS[level].tools))) return level
  }
  return "custom"
}

/** Tools the agent gets without listing them (they come with read or write access). */
export function includedTools(tools: readonly BuiltinToolName[]): BuiltinToolName[] {
  return expandBuiltinTools(tools).filter((name) => !tools.includes(name))
}

/** The highest risk among the given tools. */
export function riskOfTools(tools: readonly BuiltinToolName[]): AbilityRisk {
  if (tools.includes("shell_run")) return "high"
  if (
    tools.includes("fs_write") ||
    tools.includes("fs_edit") ||
    tools.includes("browser_run_flow") ||
    tools.includes("brain_propose_reverification")
  ) {
    return "medium"
  }
  return "low"
}

/** Turn one tool on or off, keeping the canonical order. */
export function toggleTool(
  tools: readonly BuiltinToolName[],
  name: BuiltinToolName,
  on: boolean
): BuiltinToolName[] {
  const set = new Set(tools)
  if (on) set.add(name)
  else set.delete(name)
  return BUILTIN_TOOL_NAMES.filter((tool) => set.has(tool))
}
