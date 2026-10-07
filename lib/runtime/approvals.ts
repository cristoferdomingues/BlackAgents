import { randomUUID } from "node:crypto"

import type { ApprovalDecision, ApprovalRequest } from "./types"

/**
 * In-process registry of tool calls waiting for the user. The app runs as one
 * local server, so memory is the source of truth; a workflow run also copies
 * its pending request to the run file so the UI can show it after a reload.
 */

export const APPROVAL_TIMEOUT_MS = 15 * 60_000

interface PendingApproval {
  request: ApprovalRequest
  resolve: (decision: ApprovalDecision) => void
  timer: ReturnType<typeof setTimeout>
}

const globalKey = Symbol.for("black-agents.approvals")
type GlobalWithApprovals = typeof globalThis & {
  [globalKey]?: Map<string, PendingApproval>
}

function registry(): Map<string, PendingApproval> {
  const g = globalThis as GlobalWithApprovals
  if (!g[globalKey]) g[globalKey] = new Map()
  return g[globalKey]
}

export interface ApprovalHandle {
  request: ApprovalRequest
  decision: Promise<ApprovalDecision>
}

/** Register a pending approval. It denies itself on timeout or abort. */
export function requestApproval(
  input: Omit<ApprovalRequest, "id" | "createdAt">,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): ApprovalHandle {
  const request: ApprovalRequest = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const map = registry()
  const decision = new Promise<ApprovalDecision>((resolve) => {
    const finish = (d: ApprovalDecision) => {
      const pending = map.get(request.id)
      if (!pending) return
      clearTimeout(pending.timer)
      map.delete(request.id)
      resolve(d)
    }
    const timer = setTimeout(
      () => finish({ approved: false }),
      options.timeoutMs ?? APPROVAL_TIMEOUT_MS
    )
    map.set(request.id, { request, resolve: finish, timer })
    if (options.signal) {
      if (options.signal.aborted) finish({ approved: false })
      else
        options.signal.addEventListener("abort", () => finish({ approved: false }), {
          once: true,
        })
    }
  })
  return { request, decision }
}

/** Resolve a pending approval. Returns false when it no longer exists. */
export function resolveApproval(id: string, decision: ApprovalDecision): boolean {
  const pending = registry().get(id)
  if (!pending) return false
  pending.resolve(decision)
  return true
}

export function listPendingApprovals(): ApprovalRequest[] {
  return [...registry().values()]
    .map((p) => p.request)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function getPendingApproval(id: string): ApprovalRequest | null {
  return registry().get(id)?.request ?? null
}
