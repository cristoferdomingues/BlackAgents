"use client"

import * as React from "react"
import Link from "next/link"

import { apiFetch } from "@/lib/api"
import type { ApprovalRequest } from "@/lib/runtime/types"
import { ApprovalCard } from "@/components/features/approvals/approval-card"

const POLL_MS = 5_000

/** Tool calls from background workflow runs that are waiting for the user. */
export function PendingApprovalsPanel() {
  const [approvals, setApprovals] = React.useState<ApprovalRequest[]>([])

  const load = React.useCallback((): void => {
    apiFetch<{ approvals: ApprovalRequest[] }>("/api/approvals")
      .then((data) => setApprovals(data.approvals.filter((a) => a.scope.kind === "run")))
      .catch(() => {
        // The list refreshes on the next poll.
      })
  }, [])

  React.useEffect(() => {
    const timer = setInterval(load, POLL_MS)
    const first = setTimeout(load, 0)
    return () => {
      clearInterval(timer)
      clearTimeout(first)
    }
  }, [load])

  if (approvals.length === 0) return null

  return (
    <section aria-label="Waiting for approval" className="space-y-3">
      <h2 className="text-sm font-semibold">Waiting for your approval</h2>
      {approvals.map((approval) => (
        <div key={approval.id} className="space-y-1">
          {approval.scope.kind === "run" ? (
            <p className="text-xs text-muted-foreground">
              Workflow <span className="font-medium text-foreground">{approval.scope.workflow}</span>, step{" "}
              <span className="font-medium text-foreground">{approval.scope.stepId}</span> ·{" "}
              <Link className="underline underline-offset-2" href={`/workflows/runs/${approval.scope.runId}`}>
                Open run
              </Link>
            </p>
          ) : null}
          <ApprovalCard approval={approval} onResolved={load} />
        </div>
      ))}
    </section>
  )
}
