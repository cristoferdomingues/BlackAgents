import { riskOf } from "./approval-policy"
import { requestApproval } from "./approvals"
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalScope,
  RuntimeTool,
} from "./types"

export type Approver = (
  tool: RuntimeTool,
  args: Record<string, unknown>
) => Promise<ApprovalDecision>

/** Build an approver that parks the call in the approval registry. */
export function createRegistryApprover(options: {
  scope: ApprovalScope
  signal?: AbortSignal
  onRequest?: (request: ApprovalRequest) => void | Promise<void>
  onResolved?: (request: ApprovalRequest, decision: ApprovalDecision) => void | Promise<void>
}): Approver {
  return async (tool, args) => {
    const handle = requestApproval(
      {
        tool: tool.originalName,
        server: tool.server,
        risk: riskOf(tool, args),
        summary: tool.summarize?.(args) ?? `${tool.originalName}(${JSON.stringify(args)})`,
        args,
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
