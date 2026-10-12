"use client"

import * as React from "react"
import { Loader2, Mic, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { MODEL_TASKS, type ModelTask } from "@/lib/llm/task-models"
import { ModelCombobox } from "@/components/features/chat/model-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface TaskModelsSnapshot {
  task: ModelTask
  saved: string | null
  defaultModel: string | null
  effective: string | null
  custom: { configured: boolean; isOpenRouter: boolean }
  models: Array<{ id: string; name?: string }>
  filtered: boolean
  warning?: string
}

const TASK_ICONS: Record<ModelTask, React.ComponentType<{ className?: string }>> = {
  voice: Mic,
}

/** Settings → AI → Models by task: one tab per job that needs its own model. */
export function TaskModelsCard() {
  const tasks = Object.values(MODEL_TASKS)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Models by task</CardTitle>
        <CardDescription>
          Some jobs need a model that can do more than chat. The Assistant header model still answers
          your messages; these models only do their job.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={tasks[0]?.id}>
          <TabsList>
            {tasks.map((task) => {
              const Icon = TASK_ICONS[task.id]
              return (
                <TabsTrigger key={task.id} value={task.id} className="gap-2">
                  <Icon className="h-4 w-4" />
                  {task.label}
                </TabsTrigger>
              )
            })}
          </TabsList>
          {tasks.map((task) => (
            <TabsContent key={task.id} value={task.id} className="pt-3">
              <TaskModelPanel task={task.id} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function TaskModelPanel({ task }: { task: ModelTask }) {
  const [data, setData] = React.useState<TaskModelsSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback((): void => {
    apiFetch<TaskModelsSnapshot>(`/api/settings/ai/models?task=${task}`)
      .then((next) => {
        setData(next)
        setValue(next.saved ?? next.effective ?? "")
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load models"))
  }, [task])

  React.useEffect(() => {
    load()
  }, [load])

  async function save(model: string | null): Promise<void> {
    setBusy(true)
    try {
      await apiFetch("/api/settings/ai", {
        method: "PUT",
        body: JSON.stringify({ models: { [task]: model } }),
      })
      toast.success(model ? `${MODEL_TASKS[task].label} model saved` : "Back to the default model")
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  const definition = MODEL_TASKS[task]
  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-destructive">{error}</span>
        <Button size="sm" variant="outline" onClick={() => load()}>
          Retry
        </Button>
      </div>
    )
  }
  if (!data) return <div className="h-9 w-full animate-pulse rounded bg-muted" />

  const trimmed = value.trim()
  const unchanged = trimmed === (data.saved ?? data.effective ?? "")

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{definition.description}</p>
      {!data.custom.configured ? (
        <p className="text-sm text-muted-foreground">
          Set up AI Providers → Custom first. Then pick a model here.
        </p>
      ) : null}
      <div className="space-y-1">
        <Label className="flex items-center gap-2">
          {definition.label} model
          {data.saved ? null : data.effective ? (
            <Badge variant="secondary">Default</Badge>
          ) : null}
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <ModelCombobox
            value={value}
            onChange={setValue}
            models={data.models.map((m) => m.id)}
            disabled={busy}
            className="w-full sm:w-80"
          />
          <Button size="sm" disabled={!trimmed || unchanged || busy} onClick={() => void save(trimmed)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          {data.saved ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              <RotateCcw className="h-4 w-4" />
              Use default
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {data.warning
            ? `Could not list models (${data.warning}). You can still type a model id.`
            : data.filtered
              ? `${data.models.length} models can ${definition.fitHint}.`
              : data.custom.configured
                ? `This provider does not list what each model can do. Type a model id that can ${definition.fitHint}.`
                : null}
          {data.defaultModel && !data.saved ? ` Default: ${data.defaultModel}.` : null}
        </p>
      </div>
    </div>
  )
}
