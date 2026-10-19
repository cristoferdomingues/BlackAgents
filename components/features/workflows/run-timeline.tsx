"use client"

import * as React from "react"
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Shield,
  Wrench,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { AUDIT_PAGE_SIZE_DEFAULT } from "@/lib/workflows/audit-page"
import type { AuditEvent, AuditFilterGroup } from "@/lib/workflows/audit"
import { isTerminal, type WorkflowRun } from "@/lib/workflows/schema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { formatTime } from "./run-status"

type TimelineState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; events: AuditEvent[]; total: number; offset: number }

const PAGE_SIZE = AUDIT_PAGE_SIZE_DEFAULT

const GROUP_OPTIONS: Array<{ id: AuditFilterGroup | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "ai", label: "AI" },
  { id: "tools", label: "Tools" },
  { id: "approvals", label: "Approvals" },
  { id: "errors", label: "Errors" },
  { id: "lifecycle", label: "Lifecycle" },
]

function eventIcon(type: AuditEvent["type"]): React.ReactNode {
  switch (type) {
    case "llm_request":
    case "llm_response":
    case "empty_retry":
      return <Bot className="h-3.5 w-3.5" aria-hidden />
    case "tool_call":
    case "tool_result":
    case "tool_limit":
      return <Wrench className="h-3.5 w-3.5" aria-hidden />
    case "approval_requested":
    case "approval_resolved":
    case "login_pause":
      return <Shield className="h-3.5 w-3.5" aria-hidden />
    case "error":
    case "run_finished":
      return <XCircle className="h-3.5 w-3.5" aria-hidden />
    default:
      return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
  }
}

function summarize(event: AuditEvent): string {
  switch (event.type) {
    case "run_started":
      return `Run started · ${event.workflow}`
    case "step_started":
      return `Step started · ${event.agent}${event.model ? ` · ${event.model}` : ""}`
    case "llm_request":
      return `Model request · ${event.model} (${event.messages.length} messages)`
    case "llm_response": {
      const usage = event.usage
        ? ` · ${event.usage.inputTokens}+${event.usage.outputTokens} tokens`
        : ""
      return `Model reply · ${Math.round(event.durationMs / 1000)}s${usage}`
    }
    case "tool_call":
      return `Tool call · ${event.tool}`
    case "tool_result":
      return event.error ? `Tool failed · ${event.tool}` : `Tool done · ${event.tool}`
    case "tool_limit":
      return `Tool safety limit · accepted ${event.accepted} of ${event.requested}`
    case "context_compacted":
      return `Context protected · removed ${event.removedMessages} old messages`
    case "empty_retry":
      return "Empty model reply · asking once more"
    case "approval_requested":
      return `Needs approval · ${event.tool}`
    case "approval_resolved":
      return event.approved ? "Approval granted" : "Approval denied"
    case "login_pause":
      return "Waiting for login"
    case "retry":
      return "Retrying step"
    case "review_sent_back":
      return `Sent back to ${event.targetStep} (round ${event.round} of ${event.maxRounds})`
    case "gate":
      return `Gate · ${event.decision}`
    case "step_finished":
      return `Step ${event.status}`
    case "run_finished":
      return `Run ${event.status}`
    case "error":
      return event.message
  }
}

function detailText(event: AuditEvent): string | null {
  switch (event.type) {
    case "llm_request": {
      const parts = [
        event.systemContext ? `## System\n${event.systemContext}` : "",
        ...event.messages.map((m) => `## ${m.role}\n${m.content}`),
      ]
      return parts.filter(Boolean).join("\n\n")
    }
    case "llm_response": {
      const parts = [
        event.reasoning ? `## Reasoning\n${event.reasoning}` : "",
        `## Reply\n${event.content}`,
        event.toolCalls?.length
          ? `## Tool calls\n${JSON.stringify(event.toolCalls, null, 2)}`
          : "",
      ]
      return parts.filter(Boolean).join("\n\n")
    }
    case "tool_call":
      return JSON.stringify(event.args, null, 2)
    case "tool_result":
      return event.error ?? event.result ?? null
    case "run_started":
      return event.task
    case "review_sent_back":
      return event.reasons
    default:
      return null
  }
}

/** Audit timeline for one run: filters, expandable rows, export. */
export function RunTimeline({ run, refreshKey }: { run: WorkflowRun; refreshKey: number }) {
  const [group, setGroup] = React.useState<AuditFilterGroup | "all">("all")
  const [stepId, setStepId] = React.useState<string>("all")
  const [page, setPage] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [state, setState] = React.useState<TimelineState>({ kind: "loading" })
  const [open, setOpen] = React.useState<Set<number>>(new Set())
  const requestId = React.useRef(0)

  function changeGroup(next: AuditFilterGroup | "all"): void {
    setGroup(next)
    setPage(0)
    setOpen(new Set())
  }

  function changeStep(next: string): void {
    setStepId(next)
    setPage(0)
    setOpen(new Set())
  }

  const load = React.useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (group !== "all") params.set("group", group)
      if (stepId !== "all") params.set("stepId", stepId)
      params.set("offset", String(page * PAGE_SIZE))
      params.set("limit", String(PAGE_SIZE))
      const data = await apiFetch<{
        events: AuditEvent[]
        total?: number
        offset?: number
      }>(`/api/runs/${encodeURIComponent(run.id)}/audit?${params.toString()}`)
      if (id !== requestId.current) return
      const total = data.total ?? data.events.length
      const offset = data.offset ?? page * PAGE_SIZE
      if (total > 0 && offset >= total) {
        setPage(Math.floor((total - 1) / PAGE_SIZE))
        return
      }
      setState({ kind: "ready", events: data.events, total, offset })
    } catch (err) {
      if (id !== requestId.current) return
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not load the audit log",
      })
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [run.id, group, stepId, page])

  React.useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function exportJsonl(): Promise<void> {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/audit?format=jsonl`)
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const text = await res.text()
      const blob = new Blob([text], { type: "application/x-ndjson" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${run.id}.events.jsonl`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not export")
    }
  }

  return (
    <div className="space-y-3" data-testid="run-timeline">
        <p className="text-sm text-muted-foreground">
        Every model call and tool use for this run. Secrets are hidden. Logs are shown {PAGE_SIZE} at a time.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {GROUP_OPTIONS.map((opt) => (
          <Button
            key={opt.id}
            size="sm"
            variant={group === opt.id ? "default" : "outline"}
            onClick={() => changeGroup(opt.id)}
          >
            {opt.label}
          </Button>
        ))}
        <select
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={stepId}
          onChange={(e) => changeStep(e.target.value)}
          aria-label="Filter by step"
        >
          <option value="all">All steps</option>
          {run.steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => void exportJsonl()}>
          <Download className="h-3.5 w-3.5" />
          Export JSON
        </Button>
        {!isTerminal(run.status) ? (
          <Badge variant="outline" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Live
          </Badge>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading timeline" />
        </div>
      ) : null}
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      {state.kind === "ready" && state.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit events yet. They appear as the run works.</p>
      ) : null}
      {state.kind === "ready" ? (
        <ol className="space-y-2">
          {state.events.map((event, index) => {
            const detail = detailText(event)
            const expanded = open.has(index)
            return (
              <li key={`${event.ts}-${event.type}-${index}`}>
                <Card>
                  <CardContent className="space-y-2 p-3">
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 text-left"
                      onClick={() => {
                        if (!detail) return
                        setOpen((prev) => {
                          const next = new Set(prev)
                          if (next.has(index)) next.delete(index)
                          else next.add(index)
                          return next
                        })
                      }}
                      disabled={!detail}
                      aria-expanded={detail ? expanded : undefined}
                    >
                      {detail ? (
                        expanded ? (
                          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
                        )
                      ) : (
                        <span className="mt-0.5 w-4 shrink-0" />
                      )}
                      <span className="mt-0.5 text-muted-foreground">{eventIcon(event.type)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">{summarize(event)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatTime(event.ts)}
                          {event.stepId ? ` · ${event.stepId}` : ""}
                          {event.turn != null ? ` · turn ${event.turn + 1}` : ""}
                        </span>
                      </span>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {event.type}
                      </Badge>
                    </button>
                    {expanded && detail ? (
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs">
                        {detail}
                      </pre>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ol>
      ) : null}
      {state.kind === "ready" && state.total > PAGE_SIZE ? (
        <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Audit log pages">
          <p className="text-sm text-muted-foreground">
            Showing {state.offset + 1}–{state.offset + state.events.length} of{" "}
            {state.total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(new Set())
                setPage((current) => Math.max(0, current - 1))
              }}
              disabled={loading || state.offset === 0}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {Math.floor(state.offset / PAGE_SIZE) + 1} of{" "}
              {Math.ceil(state.total / PAGE_SIZE)}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOpen(new Set())
                setPage((current) => current + 1)
              }}
              disabled={loading || state.offset + state.events.length >= state.total}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
