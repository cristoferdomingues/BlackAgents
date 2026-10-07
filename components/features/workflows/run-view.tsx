"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, FileText, Loader2, Square } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { streamGet } from "@/lib/sse-client"
import { isTerminal, isWorkflowRun, type WorkflowRun } from "@/lib/workflows/schema"
import { ApprovalCard } from "@/components/features/approvals/approval-card"
import { FeedbackBar } from "@/components/features/chat/feedback-bar"
import { ToolExecutionsSection } from "@/components/features/chat/message-parts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { formatTime, RunStatusBadge } from "./run-status"

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; run: WorkflowRun }

/** Live view of one workflow run: steps, outputs, approvals, cancel. */
export function RunView({ id }: { id: string }) {
  const [state, setState] = React.useState<ViewState>({ kind: "loading" })
  const [cancelling, setCancelling] = React.useState(false)

  React.useEffect(() => {
    const controller = new AbortController()
    streamGet(
      `/api/runs/${encodeURIComponent(id)}/events`,
      (event) => {
        if (event.event === "run" && isWorkflowRun(event.data)) setState({ kind: "ready", run: event.data })
      },
      controller.signal
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return
      setState((s) =>
        s.kind === "ready" ? s : { kind: "error", message: err instanceof Error ? err.message : "Could not load the run" }
      )
    })
    return () => controller.abort()
  }, [id])

  async function cancel() {
    setCancelling(true)
    try {
      await apiFetch(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the run")
    } finally {
      setCancelling(false)
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading run" />
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-destructive">{state.message}</p>
        <Button asChild variant="outline">
          <Link href="/workflows">Back to workflows</Link>
        </Button>
      </div>
    )
  }

  const { run } = state
  const finished = isTerminal(run.status)
  const lastOutput = [...run.steps].reverse().find((s) => s.output)

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href={`/workflows/${run.workflow}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            {run.workflow}
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            Run <RunStatusBadge status={run.status} />
          </h1>
          <p className="text-xs text-muted-foreground">
            {run.trigger === "schedule" ? "Scheduled" : "Manual"} · started {formatTime(run.startedAt ?? run.createdAt)}
            {run.finishedAt ? ` · finished ${formatTime(run.finishedAt)}` : ""}
          </p>
        </div>
        {!finished ? (
          <Button variant="outline" onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Cancel run
          </Button>
        ) : null}
      </div>

      {run.task ? (
        <p className="whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm">{run.task}</p>
      ) : null}

      {run.pendingApproval ? (
        <ApprovalCard approval={run.pendingApproval} rememberLabel="Allow this exact call for the rest of this run" />
      ) : null}

      {run.error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {run.error}
        </p>
      ) : null}

      <ol className="space-y-3" aria-label="Steps">
        {run.steps.map((step, index) => (
          <li key={step.id}>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="text-sm">
                  {index + 1}. {step.id} <span className="font-normal text-muted-foreground">· {step.agent}</span>
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {step.attempts > 1 ? <Badge variant="outline">Try {step.attempts}</Badge> : null}
                  {step.gate ? (
                    <Badge variant="secondary">
                      {step.gate.by === "jev" ? `Jev: ${step.gate.decision}` : "Gate: continue"}
                    </Badge>
                  ) : null}
                  {step.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Step running" /> : null}
                  <RunStatusBadge status={step.status} />
                </div>
              </CardHeader>
              {step.output || step.error || step.toolExecutions.length > 0 || step.filesChanged.length > 0 ? (
                <CardContent className="space-y-3">
                  {step.error ? <p className="text-sm text-destructive">{step.error}</p> : null}
                  {step.output ? (
                    <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 text-sm">
                      {step.output}
                    </div>
                  ) : null}
                  {step.filesChanged.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {step.filesChanged.map((file) => (
                        <Badge key={file} variant="outline" className="gap-1 font-mono text-xs">
                          <FileText className="h-3 w-3" />
                          {file}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {step.toolExecutions.length > 0 ? <ToolExecutionsSection traces={step.toolExecutions} /> : null}
                </CardContent>
              ) : null}
            </Card>
          </li>
        ))}
      </ol>

      {finished && run.status === "succeeded" && lastOutput?.output ? (
        <FeedbackBar
          source="run"
          agent={lastOutput.agent}
          userMessage={run.task}
          reply={lastOutput.output}
          provider=""
          model=""
          runId={run.id}
        />
      ) : null}
    </div>
  )
}
