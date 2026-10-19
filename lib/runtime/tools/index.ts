import type { Artifact } from "@/lib/artifacts/types"

import {
  DEFAULT_AGENT_TOOLS,
  expandBuiltinTools,
  isBuiltinToolName,
  type BuiltinToolName,
} from "../tool-names"
import { commandEnv } from "../shell-env"
import type { RuntimeTool } from "../types"
import { brainProposeReverificationTool } from "./brain"
import { browserRunFlowTool } from "./browser-run-flow"
import { fsEditTool, fsFindTool, fsListTool, fsReadTool, fsSearchTool, fsWriteTool } from "./fs"
import { loadMcpRuntimeTools } from "./mcp"
import { shellRunTool } from "./shell"

const BUILTIN_TOOLS: Record<BuiltinToolName, RuntimeTool> = {
  fs_list: fsListTool,
  fs_read: fsReadTool,
  fs_find: fsFindTool,
  fs_search: fsSearchTool,
  fs_write: fsWriteTool,
  fs_edit: fsEditTool,
  shell_run: shellRunTool,
  browser_run_flow: browserRunFlowTool,
  brain_propose_reverification: brainProposeReverificationTool,
}

/** The runtime tools for these names, plus the tools each one brings along. */
export function builtinTools(names: readonly BuiltinToolName[]): RuntimeTool[] {
  return expandBuiltinTools(names).map((name) => BUILTIN_TOOLS[name])
}

export interface ToolScope {
  builtins: BuiltinToolName[]
  /** `undefined` = every workspace MCP server. */
  mcpServers?: string[]
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
}

/**
 * Read an agent's `tools` / `mcpServers` frontmatter. Missing `tools` means
 * read-only file access; missing `mcpServers` means every workspace server.
 */
export function agentToolScope(agent: Artifact): ToolScope {
  const tools = stringList(agent.frontmatter.tools)
  return {
    builtins: tools ? tools.filter(isBuiltinToolName) : [...DEFAULT_AGENT_TOOLS],
    mcpServers: stringList(agent.frontmatter.mcpServers),
  }
}

/** The generic assistant: read, search, write and edit files, run commands, and every MCP server. */
export const ASSISTANT_TOOL_SCOPE: ToolScope = {
  builtins: [...DEFAULT_AGENT_TOOLS, "fs_write", "shell_run"],
}

export async function buildToolset(
  workspaceRoot: string,
  scope: ToolScope
): Promise<RuntimeTool[]> {
  const builtins = builtinTools(scope.builtins)
  if (builtins.includes(shellRunTool)) void commandEnv()
  const mcp = await loadMcpRuntimeTools(workspaceRoot, scope.mcpServers)
  return [...builtins, ...mcp]
}
