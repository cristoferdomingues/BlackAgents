"use client"

import * as React from "react"
import { Bell, BellOff, Check, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import {
  alertForApproval,
  isApprovalSoundMuted,
  playApprovalChime,
  setApprovalSoundMuted,
} from "@/lib/audio/approval-alert"
import { cn } from "@/lib/utils"
import { isFileWriteTool } from "@/lib/runtime/tool-names"
import type { ApprovalRequest, ApprovalTrustHint, FileWritePermission } from "@/lib/runtime/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const RISK_LABEL: Record<ApprovalRequest["risk"], string> = {
  read: "Read",
  write: "Writes files",
  exec: "Runs a program",
}

type RiskFlags = {
  risk: ApprovalRequest["risk"]
  projectCode?: boolean
  escapesWorkspace?: boolean
}

function riskLabelOf(call: RiskFlags): string {
  if (call.projectCode) return "Runs project code"
  if (call.escapesWorkspace) return "Outside workspace"
  return RISK_LABEL[call.risk]
}

function trustLabel(hint: ApprovalTrustHint): string {
  return hint.kind === "mcp"
    ? `Always trust ${hint.server}`
    : `Always allow ${hint.programs.join(", ")}`
}

/**
 * Approve / deny one tool call, or every call a turn wants to run. A batch
 * card lists each call with a checkbox so one decision covers the whole plan
 * instead of asking again for every call.
 */
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
  const [busy, setBusy] = React.useState<
    "approve" | "deny" | "remember" | "message" | "session" | "trust" | null
  >(null)
  const [muted, setMuted] = React.useState(isApprovalSoundMuted)
  const calls = approval.calls ?? []
  const batch = calls.length > 1
  const [selected, setSelected] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(calls.map((call) => [call.id, true]))
  )

  React.useEffect(() => {
    void alertForApproval(approval.id)
  }, [approval.id])

  function toggleSound(): void {
    const next = !muted
    setApprovalSoundMuted(next)
    setMuted(next)
    if (!next) void playApprovalChime()
  }
  const allFileWrites =
    calls.length > 0 &&
    calls.every(
      (call) =>
        call.server === "builtin" &&
        isFileWriteTool(call.tool) &&
        call.risk === "write"
    )
  const fileWriteChoice =
    approval.scope.kind === "chat" &&
    (batch
      ? allFileWrites
      : approval.server === "builtin" &&
        isFileWriteTool(approval.tool) &&
        approval.risk === "write")
  const batchDecisions = batch
    ? Object.fromEntries(calls.map((call) => [call.id, selected[call.id] !== false]))
    : undefined
  const selectedCount = batch
    ? calls.filter((call) => selected[call.id] !== false).length
    : 0
  const labels = new Set(calls.map(riskLabelOf))
  const riskLabel = batch && labels.size > 1 ? "Mixed" : riskLabelOf(approval)
  // One grant the whole card can remember, when every call shares it.
  const trustHint = approval.trust ?? (calls.length === 1 ? calls[0].trust : undefined)

  async function decide(
    approved: boolean,
    remember = false,
    fileWritePermission?: FileWritePermission,
    callDecisions?: Record<string, boolean>
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
          body: JSON.stringify({
            approved,
            remember,
            fileWritePermission,
            ...(callDecisions ? { callDecisions } : {}),
          }),
        }
      )
      onResolved?.(approved, result.fileWritePermission)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the decision")
    } finally {
      setBusy(null)
    }
  }

  /**
   * Save the grant, then approve this turn's calls. The running turn already
   * loaded its policy, so these calls still need the decision; the next turn
   * skips the card.
   */
  async function trustAndApprove(hint: ApprovalTrustHint) {
    setBusy("trust")
    try {
      await apiFetch(hint.kind === "mcp" ? "/api/mcp/policy" : "/api/trust", {
        method: "PUT",
        body: JSON.stringify(
          hint.kind === "mcp"
            ? { server: hint.server, trust: "trusted" }
            : { shellCommands: hint.programs, trusted: true }
        ),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the trust setting")
      setBusy(null)
      return
    }
    toast.success(
      hint.kind === "mcp"
        ? `${hint.server} tools will not ask again`
        : `${hint.programs.join(", ")} will not ask again`
    )
    setBusy(null)
    await decide(true, false, undefined, batchDecisions)
  }

  return (
    <div
      role="alert"
      aria-label={
        batch ? `Approval needed for ${calls.length} tool calls` : `Approval needed for ${approval.tool}`
      }
      className={cn(
        "space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-left text-sm",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        <span className="font-medium">
          {batch ? `${calls.length} tool calls need approval` : "Approval needed"}
        </span>
        <Badge variant="outline">{riskLabel}</Badge>
        {batch ? null : (
          <span className="text-xs text-muted-foreground">
            {approval.server === "builtin" ? approval.tool : `${approval.server} → ${approval.tool}`}
          </span>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto h-7 w-7 text-muted-foreground"
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={muted ? "Turn on approval sound" : "Turn off approval sound"}
          title={muted ? "Turn on approval sound" : "Turn off approval sound"}
        >
          {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </Button>
      </div>
      {batch ? (
        <ul className="max-h-80 space-y-1 overflow-auto">
          {calls.map((call) => (
            <li
              key={call.id}
              className="flex items-start gap-2 rounded-md border bg-background/60 p-2"
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-amber-500"
                checked={selected[call.id] !== false}
                onChange={(event) =>
                  setSelected((prev) => ({ ...prev, [call.id]: event.target.checked }))
                }
                aria-label={`Include ${call.tool} in this approval`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{riskLabelOf(call)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {call.server === "builtin" ? call.tool : `${call.server} → ${call.tool}`}
                  </span>
                </div>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-xs">
                  {call.summary}
                </pre>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-xs">
          {approval.summary}
        </pre>
      )}
      <div className="flex flex-wrap gap-2">
        {fileWriteChoice ? (
          <>
            <Button
              size="sm"
              onClick={() => decide(true, false, "message", batchDecisions)}
              disabled={busy !== null || (batch && selectedCount === 0)}
            >
              {busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Allow for this message
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => decide(true, false, "session", batchDecisions)}
              disabled={busy !== null || (batch && selectedCount === 0)}
            >
              {busy === "session" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Allow for this session
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => decide(true, false, undefined, batchDecisions)}
              disabled={busy !== null || (batch && selectedCount === 0)}
            >
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {batch
                ? selectedCount === calls.length
                  ? `Approve all ${calls.length}`
                  : `Approve ${selectedCount} of ${calls.length}`
                : "Approve"}
            </Button>
            {trustHint ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => trustAndApprove(trustHint)}
                disabled={busy !== null || (batch && selectedCount === 0)}
                title={
                  trustHint.kind === "mcp"
                    ? `Run ${trustHint.server} tools without asking from now on`
                    : "Allow these commands without asking from now on"
                }
              >
                {busy === "trust" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {trustLabel(trustHint)}
              </Button>
            ) : null}
            {!batch && approval.risk === "exec" ? (
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
