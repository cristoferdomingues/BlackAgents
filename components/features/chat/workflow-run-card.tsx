"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2, ExternalLink, FolderOpen, Loader2, Play, Workflow as WorkflowIcon } from "lucide-react"

import { apiFetch } from "@/lib/api"
import type { WorkflowRunTurn } from "@/lib/chat/conversation-history"
import type { WorkspaceFile } from "@/lib/files/schema"
import { MAX_STEP_FILES, type Workflow, type WorkflowRun } from "@/lib/workflows/schema"
import { FilePickerDialog, WorkspaceFileChip } from "@/components/features/files/file-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/** Confirm and start a workflow the user asked for with `/name input` or `start @name`. */
export function WorkflowRunCard({
  run,
  workflow,
  description,
  available,
  onStarted,
}: {
  run: WorkflowRunTurn
  workflow?: Workflow
  description?: string
  /** False when the workflow is no longer in the workspace. */
  available: boolean
  onStarted: (runId: string, task: string) => void
}): React.ReactElement {
  const [task, setTask] = React.useState(run.task)
  const [stepFiles, setStepFiles] = React.useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    for (const s of workflow?.steps ?? []) {
      initial[s.id] = [...(s.files ?? [])]
    }
    return initial
  })
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const taskId = React.useId()

  React.useEffect(() => {
    if (!workflow) return
    setStepFiles((current) => {
      const next: Record<string, string[]> = {}
      for (const s of workflow.steps) {
        next[s.id] = current[s.id] ?? [...(s.files ?? [])]
      }
      return next
    })
  }, [workflow])

  async function start(): Promise<void> {
    setStarting(true)
    setError(null)
    try {
      const trimmed = task.trim()
      const hasFileOverrides =
        Object.values(stepFiles).some((list) => list.length > 0) ||
        Boolean(workflow?.steps.some((s) => (s.files?.length ?? 0) > 0))
      const payload: Record<string, unknown> = {}
      if (trimmed) payload.task = trimmed
      if (hasFileOverrides) payload.stepFiles = stepFiles
      const data = await apiFetch<{ run: WorkflowRun }>(
        `/api/workflows/${encodeURIComponent(run.workflow)}/runs`,
        { method: "POST", body: JSON.stringify(payload) }
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
          {workflow && workflow.steps.length > 0 ? (
            <div className="space-y-1.5 rounded-md border bg-muted/20 p-2">
              <p className="text-[11px] font-medium text-muted-foreground">Files per step</p>
              {workflow.steps.map((step, index) => {
                const currentFiles = stepFiles[step.id] ?? step.files ?? []
                return (
                  <div key={step.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">
                        {index + 1}. {step.id}:
                      </span>
                      {currentFiles.length > 0 ? (
                        currentFiles.map((fileName) => (
                          <WorkspaceFileChip
                            key={fileName}
                            name={fileName}
                            disabled={starting}
                            onRemove={() =>
                              setStepFiles((prev) => ({
                                ...prev,
                                [step.id]: currentFiles.filter((f) => f !== fileName),
                              }))
                            }
                          />
                        ))
                      ) : (
                        <span className="text-muted-foreground">No files</span>
                      )}
                    </div>
                    <FilePickerDialog
                      selectedNames={currentFiles}
                      multiSelect
                      disabled={starting || !available}
                      onPick={(picked: WorkspaceFile) => {
                        const exists = currentFiles.includes(picked.name)
                        const next = exists
                          ? currentFiles.filter((f) => f !== picked.name)
                          : currentFiles.length < MAX_STEP_FILES
                            ? [...currentFiles, picked.name]
                            : currentFiles
                        setStepFiles((prev) => ({ ...prev, [step.id]: next }))
                      }}
                      trigger={
                        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={starting || !available}>
                          <FolderOpen className="h-3 w-3" />
                          Files
                        </Button>
                      }
                    />
                  </div>
                )
              })}
            </div>
          ) : null}
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
