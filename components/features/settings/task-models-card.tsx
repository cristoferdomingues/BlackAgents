"use client"

import * as React from "react"
import { Brain, Eye, Loader2, Mic, RotateCcw, Video, Zap } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { apiFetch } from "@/lib/api"
import { isProviderId } from "@/lib/llm/model-ref"
import { chatModelTaskSchema, MODEL_TASKS, type ChatModelTask, type ModelTask } from "@/lib/llm/task-models"
import type { ProviderId } from "@/lib/llm/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { ModelCombobox } from "@/components/features/chat/model-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
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
  video: Video,
  vision: Eye,
  fast: Zap,
  reasoning: Brain,
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
              {isChatTask(task.id) ? (
                <ChatTaskPanel task={task.id} />
              ) : (
                <VoiceTaskPanel task={task.id} />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}

function isChatTask(task: ModelTask): task is ChatModelTask {
  return chatModelTaskSchema.safeParse(task).success
}

function VoiceTaskPanel({ task }: { task: ModelTask }) {
  const [data, setData] = React.useState<TaskModelsSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback((): void => {
    apiFetch<TaskModelsSnapshot>(`/api/settings/ai/models?task=${task}`)
      .then((next) => {
        setData(next)
        const savedId = typeof next.saved === "string" ? next.saved : null
        setValue(savedId ?? next.effective ?? "")
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
  if (!data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading models…</p>
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

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

const providerIdSchema = z.enum(["openai", "anthropic", "custom"])

const chatModelsResponseSchema = z.object({
  provider: providerIdSchema.optional(),
  saved: z
    .union([
      z.string(),
      z.object({ provider: providerIdSchema, model: z.string() }),
      z.null(),
    ])
    .optional(),
  effective: z.string().nullable().optional(),
  providers: z
    .array(z.object({ id: providerIdSchema, label: z.string(), verified: z.boolean() }))
    .default([]),
  models: z.array(z.object({ id: z.string(), name: z.string().optional() })).default([]),
  filtered: z.boolean().default(false),
  warning: z.string().optional(),
})

interface ChatModelsView {
  provider: ProviderId | null
  savedModel: string | null
  savedProvider: ProviderId | null
  effective: string | null
  providers: Array<{ id: ProviderId; label: string; verified: boolean }>
  models: Array<{ id: string; name?: string }>
  filtered: boolean
  warning?: string
}

function parseChatModels(data: unknown): ChatModelsView | null {
  const parsed = chatModelsResponseSchema.safeParse(data)
  if (!parsed.success) return null
  const saved = parsed.data.saved
  const savedModel = typeof saved === "string" ? saved : saved && typeof saved === "object" ? saved.model : null
  const savedProvider = saved && typeof saved === "object" ? saved.provider : null
  return {
    provider: parsed.data.provider ?? savedProvider,
    savedModel,
    savedProvider,
    effective: parsed.data.effective ?? null,
    providers: parsed.data.providers,
    models: parsed.data.models,
    filtered: parsed.data.filtered,
    ...(parsed.data.warning ? { warning: parsed.data.warning } : {}),
  }
}

const workflowUsersSchema = z.object({
  workflows: z.array(
    z.object({
      workflow: z.object({
        name: z.string(),
        steps: z.array(z.object({ id: z.string(), model: z.string().optional() }).passthrough()),
      }).passthrough(),
    }).passthrough()
  ),
})

function ChatTaskPanel({ task }: { task: ChatModelTask }) {
  const definition = MODEL_TASKS[task]
  const [data, setData] = React.useState<ChatModelsView | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [providerId, setProviderId] = React.useState<ProviderId>("openai")
  const [value, setValue] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback((requested?: ProviderId): void => {
    const query = new URLSearchParams({ task })
    if (requested) query.set("provider", requested)
    apiFetch<unknown>(`/api/settings/ai/models?${query.toString()}`)
      .then((raw) => {
        const next = parseChatModels(raw)
        if (!next) {
          setError("Could not read models")
          return
        }
        const active = requested ?? next.provider ?? next.savedProvider ?? "openai"
        setData(next)
        setProviderId(active)
        if (next.savedModel && (!requested || requested === next.savedProvider)) {
          setValue(next.savedModel)
        } else if (requested && requested !== next.savedProvider) {
          setValue("")
        } else {
          setValue(next.savedModel ?? next.effective ?? "")
        }
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
        body: JSON.stringify({
          models: { [task]: model === null ? null : { provider: providerId, model } },
        }),
      })
      toast.success(model ? `${definition.label} model saved` : `Cleared the ${definition.label} model`)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

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
  if (!data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading models…</p>
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  const trimmed = value.trim()
  const unchanged = data.savedModel
    ? trimmed === data.savedModel && providerId === data.savedProvider
    : trimmed.length === 0
  const selected = data.providers.find((item) => item.id === providerId)
  const verified = selected?.verified ?? false

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{definition.description}</p>
      <div className="space-y-1">
        <Label htmlFor={`${task}-provider`}>{definition.label} provider</Label>
        <Select
          value={providerId}
          onValueChange={(next) => {
            if (!isProviderId(next)) return
            setProviderId(next)
            load(next)
          }}
        >
          <SelectTrigger id={`${task}-provider`} className="w-full sm:w-80" aria-label={`${definition.label} provider`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.providers.map((item) => (
              <SelectItem key={item.id} value={item.id} disabled={!item.verified}>
                {item.verified ? item.label : `${item.label} — Verify under AI Providers`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${task}-model`}>{definition.label} model</Label>
        <div className="flex flex-wrap items-center gap-2">
          <ModelCombobox
            id={`${task}-model`}
            label={`${definition.label} model`}
            value={value}
            onChange={setValue}
            models={data.models.map((model) => model.id)}
            disabled={busy || !verified}
            className="w-full sm:w-80"
          />
          <Button
            size="sm"
            disabled={!trimmed || unchanged || busy || !verified}
            onClick={() => void save(trimmed)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          {data.savedModel ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
              <RotateCcw className="h-4 w-4" />
              Clear
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {data.warning
            ? `Could not load models (${data.warning}). You can still type a model id.`
            : data.filtered
              ? `${data.models.length} models can ${definition.fitHint}.`
              : data.models.length > 0
                ? `${data.models.length} models listed.`
                : `Type a model id that can ${definition.fitHint}.`}
        </p>
      </div>
      <TaskUsers task={task} />
    </div>
  )
}

function TaskUsers({ task }: { task: ChatModelTask }): React.ReactElement {
  const { artifacts } = useWorkspace()
  const [steps, setSteps] = React.useState<string[] | null>(null)

  React.useEffect(() => {
    let active = true
    apiFetch<unknown>("/api/workflows")
      .then((data) => {
        if (!active) return
        const parsed = workflowUsersSchema.safeParse(data)
        if (!parsed.success) {
          setSteps([])
          return
        }
        const needle = `task:${task}`
        const labels: string[] = []
        for (const item of parsed.data.workflows) {
          for (const step of item.workflow.steps) {
            if (step.model?.trim() === needle) labels.push(`${item.workflow.name} → ${step.id} (step)`)
          }
        }
        setSteps(labels)
      })
      .catch(() => {
        if (active) setSteps([])
      })
    return () => {
      active = false
    }
  }, [task])

  const agentLabels = artifacts
    .filter(
      (artifact) =>
        artifact.type === "agent" &&
        typeof artifact.frontmatter.model === "string" &&
        artifact.frontmatter.model.trim() === `task:${task}`
    )
    .map((artifact) => `${artifact.name} (agent)`)

  if (steps === null) {
    return <p className="text-xs text-muted-foreground">Checking where this model is used…</p>
  }
  const used = [...agentLabels, ...steps]
  if (used.length === 0) return <p className="text-sm text-muted-foreground">Not used yet</p>
  return <p className="text-sm text-muted-foreground">Used by: {used.join(", ")}</p>
}
