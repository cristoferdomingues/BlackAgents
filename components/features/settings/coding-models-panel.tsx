"use client"

import * as React from "react"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { apiFetch } from "@/lib/api"
import { CODING_MODEL_HELP } from "@/lib/k0ding/explain"
import { providerIdSchema } from "@/lib/llm/provider-id"
import type { ProviderId } from "@/lib/llm/types"
import { ModelCombobox } from "@/components/features/chat/model-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

const savedSchema = z.object({
  settings: z.object({
    models: z
      .object({
        coding: z.object({ provider: providerIdSchema, model: z.string() }).optional(),
      })
      .default({}),
  }),
})

const modelListSchema = z.object({
  models: z.array(z.object({ id: z.string() })).default([]),
  providers: z.array(z.object({ id: providerIdSchema, label: z.string() })).optional(),
})

/** Settings → AI → Models by task → Coding. */
export function CodingModelsPanel(): React.ReactElement {
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [saved, setSaved] = React.useState<{ provider: ProviderId; model: string } | null>(null)
  const [provider, setProvider] = React.useState<ProviderId>("openai")
  const [model, setModel] = React.useState("")
  const [models, setModels] = React.useState<string[]>([])
  const [providers, setProviders] = React.useState<Array<{ id: ProviderId; label: string }>>([])

  const loadModels = React.useCallback((next: ProviderId): void => {
    apiFetch<unknown>(`/api/settings/ai/models?task=fast&provider=${next}`)
      .then((raw) => {
        const parsed = modelListSchema.safeParse(raw)
        if (!parsed.success) return
        setModels(parsed.data.models.map((item) => item.id))
        if (parsed.data.providers) setProviders(parsed.data.providers)
      })
      .catch(() => setModels([]))
  }, [])

  const load = React.useCallback((): void => {
    apiFetch<unknown>("/api/settings/ai")
      .then((raw) => {
        const parsed = savedSchema.safeParse(raw)
        if (!parsed.success) {
          setError("Could not read the coding model")
          return
        }
        const choice = parsed.data.settings.models.coding ?? null
        setSaved(choice)
        const nextProvider = choice?.provider ?? "openai"
        setProvider(nextProvider)
        setModel(choice?.model ?? "")
        loadModels(nextProvider)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load models"))
      .finally(() => setLoading(false))
  }, [loadModels])

  React.useEffect(() => {
    load()
  }, [load])

  async function save(next: { provider: ProviderId; model: string } | null): Promise<void> {
    setBusy(true)
    try {
      await apiFetch("/api/settings/ai", {
        method: "PUT",
        body: JSON.stringify({ models: { coding: next } }),
      })
      toast.success(next ? "Coding model saved" : "K0ding will use the Assistant model")
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Skeleton className="h-24 w-full" />
  if (error) return <p className="text-sm text-destructive">{error}</p>

  const unchanged = (saved?.provider ?? "") === (saved ? provider : "") && (saved?.model ?? "") === model.trim()

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        Code
        {saved ? null : <Badge variant="secondary">Assistant model</Badge>}
      </Label>
      <p className="text-sm text-muted-foreground">{CODING_MODEL_HELP}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={provider}
          onValueChange={(value: ProviderId) => {
            setProvider(value)
            setModel("")
            loadModels(value)
          }}
        >
          <SelectTrigger className="w-36" aria-label="Coding provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(providers.length > 0 ? providers : [{ id: "openai" as const, label: "OpenAI" }]).map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ModelCombobox value={model} onChange={setModel} models={models} disabled={busy} className="w-full sm:w-80" label="Coding model" />
        <Button size="sm" disabled={!model.trim() || unchanged || busy} onClick={() => void save({ provider, model: model.trim() })}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
        {saved ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
            <RotateCcw className="h-4 w-4" />
            Use Assistant model
          </Button>
        ) : null}
      </div>
    </div>
  )
}
