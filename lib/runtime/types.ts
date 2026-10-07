import type { ToolExecutionTrace } from "@/lib/mcp/types"

/**
 * How dangerous a tool call is:
 * - `read`  — no side effects; runs without approval.
 * - `write` — changes workspace state; needs approval unless writes are allowed.
 * - `exec`  — runs a program or a risky server; always needs approval
 *             (unless the user allowed that exact call for the current run).
 */
export type ToolRisk = "read" | "write" | "exec"

export type ToolSource = "builtin" | "mcp"

export interface ToolContext {
  workspaceRoot: string
  signal?: AbortSignal
}

export interface ToolOutcome {
  result?: unknown
  error?: string
}

export interface RuntimeTool {
  /** Name the model sees (unique inside one toolset). */
  name: string
  description: string
  /** JSON schema for the arguments. */
  parameters: Record<string, unknown>
  source: ToolSource
  /** MCP server name, or "builtin". */
  server: string
  /** The original tool name (MCP tools are renamed to stay unique). */
  originalName: string
  risk: ToolRisk
  /** Overrides the loop's per-tool timeout (e.g. long shell commands). */
  timeoutMs?: number
  /** Optional per-call risk (e.g. writes to agent config always escalate). */
  riskFor?: (args: Record<string, unknown>) => ToolRisk
  /** One-line, human-readable description of a call, shown in approvals. */
  summarize?: (args: Record<string, unknown>) => string
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>
}

export type ApprovalScope =
  | { kind: "chat" }
  | { kind: "run"; runId: string; stepId: string; workflow: string }

export interface ApprovalRequest {
  id: string
  tool: string
  server: string
  risk: ToolRisk
  summary: string
  args: Record<string, unknown>
  scope: ApprovalScope
  createdAt: string
}

export interface ApprovalDecision {
  approved: boolean
  /** Exec only: allow this exact call again for the rest of the run. */
  remember?: boolean
  /** Why the call was denied (shown to the model). */
  reason?: string
}

export type AgentLoopEvent =
  | { type: "token"; turn: number; content: string }
  | {
      type: "tool_call"
      id: string
      tool: string
      server: string
      args: Record<string, unknown>
      risk: ToolRisk
    }
  | { type: "approval_required"; approval: ApprovalRequest }
  | { type: "approval_resolved"; id: string; approved: boolean }
  | { type: "tool_result"; trace: ToolExecutionTrace }

export type { ToolExecutionTrace }
