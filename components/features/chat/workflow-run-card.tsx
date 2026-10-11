"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, ExternalLink, Loader2, Play, Workflow as WorkflowIcon } from "lucide-react"

import { apiFetch } from "@/lib/api"
import type { WorkflowRunTurn } from "@/lib/chat/conversation-history"
import type { WorkflowRun } from "@/lib/workflows/schema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/** Confirm and start a workflow the user asked for with `/name input` or `start @name`. */
export function WorkflowRunCard({
  run,
  description,
  available,
  onStarted,
}: {
  run: WorkflowRunTurn
  description?: string
  /** False when the workflow is no longer in the workspace. */
  available: boolean
  onStarted: (runId: string, task: string) => void
}): React.ReactElement {
  const [task, setTask] = React.useState(run.task)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const taskId = React.useId()

  async function start(): Promise<void> {
    setStarting(true)
    setError(null)
    try {
      const trimmed = task.trim()
      const data = await apiFetch<{ run: WorkflowRun }>(
        `/api/workflows/${encodeURIComponent(run.workflow)}/runs`,
        { method: "POST", body: JSON.stringify(trimmed ? { task: trimmed } : {}) }
      )
      onStarted(data.run.id, trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the workflow")
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="w-full rounded-lg border bg-card p-3 text-left" data-testid="workflow-run-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <WorkflowIcon className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{run.workflow}</p>
            {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        <Badge variant={run.runId ? "secondary" : "outline"} className="shrink-0">
          {run.runId ? "Started" : "Ready to run"}
        </Badge>
      </div>
      {run.runId ? (
        <div className="mt-3 space-y-2 text-xs">
          {run.task ? (
            <p className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-muted-foreground">{run.task}</p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              The run is queued.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href={`/workflows/runs/${encodeURIComponent(run.runId)}`}>
                <ExternalLink className="h-4 w-4" />
                View run
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Label htmlFor={taskId} className="text-xs text-muted-foreground">
            Initial input (leave empty to use the workflow default)
          </Label>
          <Textarea
            id={taskId}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={3}
            maxLength={4_000}
            disabled={starting || !available}
            className="text-sm"
          />
          {!available ? (
            <p className="text-xs text-destructive" role="alert">
              This workflow is no longer in the workspace.
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button size="sm" className="w-full" onClick={() => void start()} disabled={starting || !available}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run workflow
          </Button>
        </div>
      )}
    </div>
  )
}
