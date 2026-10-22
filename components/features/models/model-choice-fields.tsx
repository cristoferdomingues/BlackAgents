"use client"

import * as React from "react"
import Link from "next/link"
import { z } from "zod"

import { apiFetch } from "@/lib/api"
import { isProviderId } from "@/lib/llm/model-ref"
import { MODEL_TASKS, type ChatModelTask } from "@/lib/llm/task-models"
import type { ProviderId } from "@/lib/llm/types"
import { ModelCombobox } from "@/components/features/chat/model-combobox"
import {
  PROVIDER_OPTIONS,
  isTaskSelectValue,
  parseModelSelectValue,
  taskChoiceSummary,
  taskFromSelect,
  type ModelSelectValue,
  type TaskChoiceMap,
} from "@/components/features/models/model-choice"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const settingsModelsSchema = z.object({
  settings: z
    .object({
      models: z
        .object({
          vision: z.object({ provider: z.enum(["openai", "anthropic", "custom"]), model: z.string() }).optional(),
          fast: z.object({ provider: z.enum(["openai", "anthropic", "custom"]), model: z.string() }).optional(),
          reasoning: z.object({ provider: z.enum(["openai", "anthropic", "custom"]), model: z.string() }).optional(),
        })
        .partial()
        .optional(),
    })
    .passthrough(),
})

const providerModelsSchema = z.object({
  models: z.array(z.string()).default([]),
})

const CHAT_TASKS: ChatModelTask[] = ["vision", "fast", "reasoning"]

/** Saved chat-task models from Settings → Models. Missing keys mean "not set". */
export function useSavedTaskModels(enabled: boolean): { choices: TaskChoiceMap; loading: boolean } {
  const [choices, setChoices] = React.useState<TaskChoiceMap>({})
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!enabled) return
    let active = true
    void Promise.resolve().then(() => {
      if (!active) return
      setLoading(true)
      apiFetch<unknown>("/api/settings/ai")
        .then((data) => {
          if (!active) return
          const parsed = settingsModelsSchema.safeParse(data)
          const models = parsed.success ? parsed.data.settings.models : undefined
          const next: TaskChoiceMap = {}
          if (models?.vision) next.vision = models.vision
          if (models?.fast) next.fast = models.fast
          if (models?.reasoning) next.reasoning = models.reasoning
          setChoices(next)
        })
        .catch(() => {
          if (active) setChoices({})
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    })
    return () => {
      active = false
    }
  }, [enabled])

  return { choices: enabled ? choices : {}, loading: enabled && loading }
}

function useProviderModels(provider: ProviderId | null): { models: string[]; loading: boolean; failed: boolean } {
  const [listed, setListed] = React.useState<{
    id: ProviderId
    models: string[]
    failed: boolean
  } | null>(null)

  React.useEffect(() => {
    if (!provider) return
    let active = true
    const id = provider
    void Promise.resolve().then(() => {
      if (!active) return
      apiFetch<unknown>(`/api/providers/models?id=${encodeURIComponent(id)}`)
        .then((data) => {
          if (!active) return
          const parsed = providerModelsSchema.safeParse(data)
          setListed({
            id,
            models: parsed.success ? parsed.data.models : [],
            failed: !parsed.success,
          })
        })
        .catch(() => {
          if (active) setListed({ id, models: [], failed: true })
        })
    })
    return () => {
      active = false
    }
  }, [provider])

  if (!provider) return { models: [], loading: false, failed: false }
  if (listed?.id !== provider) return { models: [], loading: true, failed: false }
  return { models: listed.models, loading: false, failed: listed.failed }
}

/** Provider / task-kind select plus a model box. Task kinds hide the model box. */
export function ModelChoiceFields({
  idPrefix,
  selectLabel,
  modelLabel,
  value,
  model,
  onValueChange,
  onModelChange,
  taskChoices,
}: {
  idPrefix: string
  selectLabel: string
  modelLabel: string
  value: ModelSelectValue
  model: string
  onValueChange: (value: ModelSelectValue) => void
  onModelChange: (model: string) => void
  taskChoices: TaskChoiceMap
}): React.ReactElement {
  const providerId = isProviderId(value) ? value : null
  const task = taskFromSelect(value)
  const listed = useProviderModels(providerId)
  const showModel = providerId !== null || (value === "inherit" && model.trim().length > 0)

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-provider`}>{selectLabel}</Label>
        <Select value={value} onValueChange={(next) => onValueChange(parseModelSelectValue(next))}>
          <SelectTrigger id={`${idPrefix}-provider`} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit</SelectItem>
            {PROVIDER_OPTIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Task kind</SelectLabel>
              {CHAT_TASKS.map((kind) => (
                <SelectItem key={kind} value={`task:${kind}`}>
                  {MODEL_TASKS[kind].label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {showModel ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-model`}>{modelLabel}</Label>
          <ModelCombobox
            id={`${idPrefix}-model`}
            label={modelLabel}
            value={model}
            onChange={onModelChange}
            models={listed.models}
            loading={listed.loading}
            className="w-full sm:w-80"
          />
          {value === "inherit" ? (
            <p className="text-xs text-muted-foreground">
              No provider is set. The chat or workflow provider is used.
            </p>
          ) : null}
          {listed.failed ? (
            <p className="text-xs text-muted-foreground">
              Could not load the model list. You can still type a model id.
            </p>
          ) : null}
        </div>
      ) : null}
      {task && isTaskSelectValue(value) ? (
        <TaskKindSummary task={task} choice={taskChoices[task]} />
      ) : null}
    </div>
  )
}

function TaskKindSummary({
  task,
  choice,
}: {
  task: ChatModelTask
  choice: { provider: ProviderId; model: string } | undefined
}): React.ReactElement {
  const summary = taskChoiceSummary(task, choice)
  if (choice) {
    return <p className="text-sm text-muted-foreground">{summary}</p>
  }
  return (
    <p className="text-sm text-muted-foreground">
      task:{task} →{" "}
      <Link href="/settings/models" className="text-primary underline">
        not set
      </Link>
    </p>
  )
}
