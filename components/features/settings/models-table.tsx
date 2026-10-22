"use client"

import * as React from "react"
import { Pencil } from "lucide-react"

import { apiFetch } from "@/lib/api"
import { MODEL_TASKS } from "@/lib/llm/task-models"
import { modelRows, MODELS_EDIT_EFFECT, parseSavedModels, type ModelRow, type ModelRowId } from "@/lib/settings/model-rows"
import { CodingModelsPanel } from "@/components/features/settings/coding-models-panel"
import { MeetingModelsPanel } from "@/components/features/settings/meeting-models-panel"
import { ChatTaskPanel, isChatTask, VoiceTaskPanel } from "@/components/features/settings/task-model-panels"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/** Settings → Models: every job and its model in one table. Edit opens that job's picker. */
export function ModelsTable(): React.ReactElement {
  const [rows, setRows] = React.useState<ModelRow[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<ModelRow | null>(null)

  const load = React.useCallback((): void => {
    apiFetch<unknown>("/api/settings/ai")
      .then((raw) => {
        const models = parseSavedModels(raw)
        if (!models) {
          setError("Could not read the saved models")
          return
        }
        setRows(modelRows(models))
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load models"))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border p-4 text-sm">
        <span className="text-destructive">{error}</span>
        <Button size="sm" variant="outline" onClick={() => load()}>
          Retry
        </Button>
      </div>
    )
  }
  if (!rows) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading models…</p>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Job</TableHead>
              <TableHead>What it does</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="w-20">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-muted-foreground">{row.job}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-xs">{row.current}</span>
                    {row.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" aria-label={`Edit ${row.label}`} onClick={() => setEditing(row)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{MODELS_EDIT_EFFECT}</p>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (open) return
          setEditing(null)
          load()
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {editing ? (
            <>
              <DialogHeader>
                <DialogTitle>{`${editing.label} model`}</DialogTitle>
                <DialogDescription>{editing.job}</DialogDescription>
              </DialogHeader>
              <ModelPanel id={editing.id} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ModelPanel({ id }: { id: ModelRowId }): React.ReactElement {
  if (id === "meeting") return <MeetingModelsPanel />
  if (id === "coding") return <CodingModelsPanel />
  const task = MODEL_TASKS[id].id
  return isChatTask(task) ? <ChatTaskPanel task={task} /> : <VoiceTaskPanel task={task} />
}
