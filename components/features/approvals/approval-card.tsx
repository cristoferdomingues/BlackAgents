"use client"

import * as React from "react"
import { Check, Loader2, ShieldAlert, X } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ApprovalRequest, FileWritePermission } from "@/lib/runtime/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const RISK_LABEL: Record<ApprovalRequest["risk"], string> = {
  read: "Read",
  write: "Writes files",
  exec: "Runs a program",
}

/** Approve / deny one tool call that is waiting for the user. */
export function ApprovalCard({
  approval,
  rememberLabel = "Allow this exact call again in this run",
  onResolved,
  className,
}: {
  approval: ApprovalRequest
  rememberLabel?: string
  onResolved?: (approved: boolean, fileWritePermission?: FileWritePermission) => void
  className?: string
}) {
  const [busy, setBusy] = React.useState<"approve" | "deny" | "remember" | "message" | "session" | null>(null)
  const fileWriteChoice =
    approval.scope.kind === "chat" && approval.tool === "fs_write" && approval.risk === "write"

  async function decide(
    approved: boolean,
    remember = false,
    fileWritePermission?: FileWritePermission
  ) {
    const action = !approved
      ? "deny"
      : fileWritePermission === "session"
        ? "session"
        : fileWritePermission === "message"
          ? "message"
          : remember
            ? "remember"
            : "approve"
    setBusy(action)
    try {
      const result = await apiFetch<{ fileWritePermission?: FileWritePermission }>(
        `/api/approvals/${encodeURIComponent(approval.id)}`,
        {
          method: "POST",
          body: JSON.stringify({ approved, remember, fileWritePermission }),
        }
      )
      onResolved?.(approved, result.fileWritePermission)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the decision")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="alert"
      aria-label={`Approval needed for ${approval.tool}`}
      className={cn(
        "space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-left text-sm",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        <span className="font-medium">Approval needed</span>
        <Badge variant="outline">{RISK_LABEL[approval.risk]}</Badge>
        <span className="text-xs text-muted-foreground">
          {approval.server === "builtin" ? approval.tool : `${approval.server} → ${approval.tool}`}
        </span>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-xs">
        {approval.summary}
      </pre>
      <div className="flex flex-wrap gap-2">
        {fileWriteChoice ? (
          <>
            <Button size="sm" onClick={() => decide(true, false, "message")} disabled={busy !== null}>
              {busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Allow for this message
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => decide(true, false, "session")}
              disabled={busy !== null}
            >
              {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Allow for this session
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => decide(true)} disabled={busy !== null}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve
            </Button>
            {approval.risk === "exec" ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => decide(true, true)}
                disabled={busy !== null}
              >
                {busy === "remember" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {rememberLabel}
              </Button>
            ) : null}
          </>
        )}
        <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={busy !== null}>
          {busy === "deny" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          Deny
        </Button>
      </div>
    </div>
  )
}
