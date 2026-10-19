"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, FileText, Loader2, Square } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { streamGet } from "@/lib/sse-client"
import { formatElapsed } from "@/lib/workflows/live"
import { isTerminal, isWorkflowRun, type WorkflowRun } from "@/lib/workflows/schema"
import { ApprovalCard } from "@/components/features/approvals/approval-card"
import { LoginCard } from "@/components/features/workflows/login-card"
import { FeedbackBar } from "@/components/features/chat/feedback-bar"
import { ToolExecutionsSection } from "@/components/features/chat/message-parts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { formatRunStepModel } from "@/components/features/models/model-choice"

import { formatTime, RunStatusBadge } from "./run-status"
import { RunTimeline } from "./run-timeline"
import { StepActivityPanel } from "./step-activity"
import { useNow } from "./use-now"

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; run: WorkflowRun }

type Connection = "connecting" | "live" | "reconnecting"

const PING_STALE_MS = 45_000

/** Live view of one workflow run: steps, outputs, approvals, cancel. */
export function RunView({ id }: { id: string }) {
  const [state, setState] = React.useState<ViewState>({ kind: "loading" })
  const [cancelling, setCancelling] = React.useState(false)
  const [connection, setConnection] = React.useState<Connection>("connecting")
  const [lastPingAt, setLastPingAt] = React.useState<number | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [tab, setTab] = React.useState("steps")

  React.useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const connect = (): void => {
      if (cancelled) return
      controller?.abort()
      controller = new AbortController()
      setConnection((c) => (c === "live" ? "reconnecting" : "connecting"))
      streamGet(
        `/api/runs/${encodeURIComponent(id)}/events`,
        (event) => {
          if (event.event === "ping") {
            setLastPingAt(Date.now())
            setConnection("live")
            return
          }
          if (event.event === "run" && isWorkflowRun(event.data)) {
            setLastPingAt(Date.now())
            setConnection("live")
            setState({ kind: "ready", run: event.data })
            setRefreshKey((k) => k + 1)
          }
        },
        controller.signal
      )
        .then(() => {
          if (cancelled) return
          setState((s) => {
            if (s.kind === "ready" && isTerminal(s.run.status)) return s
            setConnection("reconnecting")
            reconnectTimer = setTimeout(connect, 1_500)
            return s
          })
        })
        .catch((err: unknown) => {
          if (controller?.signal.aborted || cancelled) return
          setState((s) => {
            if (s.kind === "ready") {
              setConnection("reconnecting")
              reconnectTimer = setTimeout(connect, 1_500)
              return s
            }
            return {
              kind: "error",
              message: err instanceof Error ? err.message : "Could not load the run",
            }
          })
        })
    }

    connect()
    return () => {
      cancelled = true
      controller?.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [id])

  const now = useNow(
    1_000,
    state.kind === "ready" && !isTerminal(state.run.status)
  )
  const pingFresh = lastPingAt != null && now - lastPingAt < PING_STALE_MS
  // Stay "Live" through brief reconnects while we still have a fresh ping/run event.
  const connectionLabel =
    connection === "connecting" && !pingFresh
      ? "Connecting"
      : pingFresh || connection === "live"
        ? "Live"
        : "Reconnecting"

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
  const runStarted = run.startedAt ?? run.createdAt
  const runElapsed = formatElapsed(Math.max(0, now - Date.parse(runStarted)))

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href={`/workflows/${run.workflow}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" />
            {run.workflow}
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            Run <RunStatusBadge status={run.status} />
            {!finished ? (
              <Badge
                variant="outline"
                data-testid="run-connection"
                className={
                  connectionLabel === "Live"
                    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/50 text-amber-600 dark:text-amber-400"
                }
              >
                <span
                  className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                    connectionLabel === "Live" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                  aria-hidden
                />
                {connectionLabel}
              </Badge>
            ) : null}
          </h1>
          <p className="text-xs text-muted-foreground">
            {run.trigger === "schedule" ? "Scheduled" : "Manual"} · started {formatTime(run.startedAt ?? run.createdAt)}
            {run.finishedAt ? ` · finished ${formatTime(run.finishedAt)}` : ` · elapsed ${runElapsed}`}
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

      {run.pendingLogin ? <LoginCard runId={run.id} login={run.pendingLogin} /> : null}

      {run.error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {run.error}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="steps" className="mt-4 space-y-3">
          <ol className="space-y-3" aria-label="Steps">
            {run.steps.map((step, index) => {
              const modelLine = formatRunStepModel(step)
              return (
                <li key={step.id}>
                  <Card>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                      <CardTitle className="text-sm">
                        {index + 1}. {step.id}{" "}
                        <span className="font-normal text-muted-foreground">· {step.agent}</span>
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        {step.attempts > 1 ? <Badge variant="outline">Try {step.attempts}</Badge> : null}
                        {step.gate ? (
                          <Badge variant="secondary">
                            {step.gate.by === "jev" ? `Jev: ${step.gate.decision}` : "Gate: continue"}
                          </Badge>
                        ) : null}
                        {step.verdict ? (
                          <Badge variant={step.verdict === "reject" ? "destructive" : "secondary"}>
                            {step.verdict === "reject" ? "Review: rejected" : "Review: approved"}
                          </Badge>
                        ) : null}
                        {step.status === "running" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Step running" />
                        ) : null}
                        <RunStatusBadge status={step.status} />
                      </div>
                      {modelLine ? <p className="w-full text-xs text-muted-foreground">{modelLine}</p> : null}
                    </CardHeader>
                    {step.output ||
                    step.error ||
                    step.toolExecutions.length > 0 ||
                    step.filesChanged.length > 0 ||
                    step.activity ||
                    (step.recent && step.recent.length > 0) ? (
                      <CardContent className="space-y-3">
                        <StepActivityPanel
                          step={step}
                          stepTimeoutMinutes={run.limits?.stepTimeoutMinutes}
                        />
                        {step.error ? <p className="text-sm text-destructive">{step.error}</p> : null}
                        {step.output ? (
                          <div className="prose-ba max-h-96 overflow-auto break-words rounded-md bg-muted/30 p-3">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.output}</ReactMarkdown>
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
                        {step.toolExecutions.length > 0 ? (
                          <ToolExecutionsSection traces={step.toolExecutions} />
                        ) : null}
                      </CardContent>
                    ) : null}
                  </Card>
                </li>
              )
            })}
          </ol>
        </TabsContent>
        <TabsContent value="timeline" className="mt-4">
          <RunTimeline run={run} refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>

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
