import type { Artifact } from "@/lib/artifacts/types"

import {
  DEFAULT_AGENT_TOOLS,
  isBuiltinToolName,
  type BuiltinToolName,
} from "../tool-names"
import type { RuntimeTool } from "../types"
import { fsListTool, fsReadTool, fsWriteTool } from "./fs"
import { loadMcpRuntimeTools } from "./mcp"
import { shellRunTool } from "./shell"

const BUILTIN_TOOLS: Record<BuiltinToolName, RuntimeTool> = {
  fs_list: fsListTool,
  fs_read: fsReadTool,
  fs_write: fsWriteTool,
  shell_run: shellRunTool,
}

export function builtinTools(names: readonly BuiltinToolName[]): RuntimeTool[] {
  return [...new Set(names)].map((name) => BUILTIN_TOOLS[name])
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

/** The generic assistant: read-only files plus every MCP server. */
export const ASSISTANT_TOOL_SCOPE: ToolScope = { builtins: [...DEFAULT_AGENT_TOOLS] }

export async function buildToolset(
  workspaceRoot: string,
  scope: ToolScope
): Promise<RuntimeTool[]> {
  const mcp = await loadMcpRuntimeTools(workspaceRoot, scope.mcpServers)
  return [...builtinTools(scope.builtins), ...mcp]
}
