import { riskOf } from "./approval-policy"
import { requestApproval } from "./approvals"
import { isFileWriteTool } from "./tool-names"
import { analyzeShellCommand } from "./tools/shell-risk"
import type {
  ApprovalCall,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalScope,
  ApprovalTrustHint,
  BatchApprovalCall,
  RuntimeTool,
  ToolRisk,
} from "./types"

export type Approver = (
  tool: RuntimeTool,
  args: Record<string, unknown>
) => Promise<ApprovalDecision>

export type BatchApprover = (
  calls: BatchApprovalCall[]
) => Promise<Record<string, ApprovalDecision>>

function summarize(tool: RuntimeTool, args: Record<string, unknown>): string {
  return tool.summarize?.(args) ?? `${tool.originalName}(${JSON.stringify(args)})`
}

const RISK_ORDER: Record<ToolRisk, number> = { read: 0, write: 1, exec: 2 }

function highestRisk(calls: readonly BatchApprovalCall[]): ToolRisk {
  return calls.reduce<ToolRisk>((max, call) => {
    const risk = riskOf(call.tool, call.args)
    return RISK_ORDER[risk] > RISK_ORDER[max] ? risk : max
  }, "read")
}

/**
 * A persistent trust grant the approval card may offer for this call.
 *
 * MCP: trusting a server turns its `write` calls into reads; `exec` calls
 * always ask, so there is nothing useful to offer there. Shell: only a plain
 * sequence of write-risk programs can be remembered — redirects, substitutions
 * and `exec` commands never are.
 */
export function trustHintForTool(
  tool: RuntimeTool,
  args: Record<string, unknown>
): ApprovalTrustHint | undefined {
  if (tool.source === "mcp") {
    return riskOf(tool, args) === "write" ? { kind: "mcp", server: tool.server } : undefined
  }
  if (tool.source === "builtin" && tool.originalName === "shell_run") {
    const analysis = analyzeShellCommand(args.command, args.args)
    if (analysis.trustable && analysis.programs.length > 0) {
      return { kind: "shell", programs: [...new Set(analysis.programs)].sort() }
    }
  }
  return undefined
}

function trustHintKey(hint: ApprovalTrustHint): string {
  return hint.kind === "mcp" ? `mcp:${hint.server}` : `shell:${hint.programs.join(",")}`
}

/** The single grant every call in the card shares, if there is one. */
function commonTrustHint(
  hints: readonly (ApprovalTrustHint | undefined)[]
): ApprovalTrustHint | undefined {
  const first = hints[0]
  if (!first) return undefined
  const key = trustHintKey(first)
  return hints.every((hint) => hint !== undefined && trustHintKey(hint) === key)
    ? first
    : undefined
}

/** One approval card for every call a turn wants to run. */
export function createRegistryBatchApprover(options: {
  scope: ApprovalScope
  signal?: AbortSignal
  onRequest?: (request: ApprovalRequest) => void | Promise<void>
  onResolved?: (
    request: ApprovalRequest,
    decisions: Record<string, ApprovalDecision>
  ) => void | Promise<void>
}): BatchApprover {
  return async (calls) => {
    if (calls.length === 0) return {}
    const single = calls.length === 1
    const trustHints = calls.map((call) => trustHintForTool(call.tool, call.args))
    const requestCalls: ApprovalCall[] = calls.map((call, index) => {
      const trust = trustHints[index]
      return {
        id: call.id,
        tool: call.tool.originalName,
        server: call.tool.server,
        risk: riskOf(call.tool, call.args),
        summary: summarize(call.tool, call.args),
        args: call.args,
        ...(trust ? { trust } : {}),
      }
    })
    const trust = commonTrustHint(trustHints)
    const handle = requestApproval(
      {
        tool: single ? requestCalls[0].tool : "batch",
        server: single ? requestCalls[0].server : "batch",
        risk: highestRisk(calls),
        summary: single ? requestCalls[0].summary : `${calls.length} tool calls need approval`,
        args: single ? requestCalls[0].args : {},
        calls: requestCalls,
        ...(trust ? { trust } : {}),
        scope: options.scope,
      },
      { signal: options.signal }
    )
    await options.onRequest?.(handle.request)
    const decision = await handle.decision
    const decisions: Record<string, ApprovalDecision> = {}
    for (const call of calls) {
      const approved = decision.callDecisions?.[call.id] ?? decision.approved
      const fileWrite =
        call.tool.source === "builtin" && isFileWriteTool(call.tool.originalName)
      decisions[call.id] = {
        approved,
        ...(approved && decision.remember && riskOf(call.tool, call.args) === "exec"
          ? { remember: true }
          : {}),
        ...(approved && decision.fileWritePermission && fileWrite
          ? { fileWritePermission: decision.fileWritePermission }
          : {}),
        ...(approved ? {} : { reason: "The user denied this tool call" }),
      }
    }
    await options.onResolved?.(handle.request, decisions)
    return decisions
  }
}

/** Build an approver that parks the call in the approval registry. */
export function createRegistryApprover(options: {
  scope: ApprovalScope
  signal?: AbortSignal
  onRequest?: (request: ApprovalRequest) => void | Promise<void>
  onResolved?: (request: ApprovalRequest, decision: ApprovalDecision) => void | Promise<void>
}): Approver {
  return async (tool, args) => {
    const trust = trustHintForTool(tool, args)
    const handle = requestApproval(
      {
        tool: tool.originalName,
        server: tool.server,
        risk: riskOf(tool, args),
        summary: tool.summarize?.(args) ?? `${tool.originalName}(${JSON.stringify(args)})`,
        args,
        ...(trust ? { trust } : {}),
        scope: options.scope,
      },
      { signal: options.signal }
    )
    await options.onRequest?.(handle.request)
    const decision = await handle.decision
    await options.onResolved?.(handle.request, decision)
    return decision
  }
}

/** Non-interactive callers: deny anything that needs approval. */
export const denyAllApprover: Approver = async () => ({
  approved: false,
  reason: "This call needs user approval, which is only available in the streaming chat.",
})
