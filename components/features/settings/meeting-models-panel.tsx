"use client"

import * as React from "react"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { apiFetch } from "@/lib/api"
import { providerIdSchema } from "@/lib/llm/provider-id"
import type { ProviderId } from "@/lib/llm/types"
import {
  LISTEN_COST,
  MEETING_LISTEN_HELP,
  MEETING_NOTES_HELP,
} from "@/lib/meetings/explain"
import { OPENAI_LISTEN_MODELS, type MeetingListenChoice, type MeetingNotesChoice } from "@/lib/meetings/models"
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
        voice: z.string().optional(),
        meeting: z
          .object({
            listen: z.object({ provider: z.enum(["openai", "custom"]), model: z.string() }).optional(),
            notes: z.object({ provider: providerIdSchema, model: z.string() }).optional(),
          })
          .optional(),
      })
      .default({}),
  }),
})

const modelListSchema = z.object({
  models: z.array(z.object({ id: z.string() })).default([]),
  providers: z.array(z.object({ id: providerIdSchema, label: z.string() })).optional(),
  warning: z.string().optional(),
})

/** Settings → AI → Models by task → Meeting. Two pickers: Listen and Notes. */
export function MeetingModelsPanel() {
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<"listen" | "notes" | null>(null)
  const [listen, setListen] = React.useState<MeetingListenChoice | null>(null)
  const [notes, setNotes] = React.useState<MeetingNotesChoice | null>(null)
  const [listenProvider, setListenProvider] = React.useState<"openai" | "custom">("openai")
  const [listenModel, setListenModel] = React.useState("whisper-1")
  const [listenModels, setListenModels] = React.useState<string[]>([...OPENAI_LISTEN_MODELS])
  const [notesProvider, setNotesProvider] = React.useState<ProviderId>("openai")
  const [notesModel, setNotesModel] = React.useState("")
  const [notesModels, setNotesModels] = React.useState<string[]>([])
  const [noteProviders, setNoteProviders] = React.useState<Array<{ id: ProviderId; label: string }>>([])

  const loadNotesModels = React.useCallback((provider: ProviderId): void => {
    apiFetch<unknown>(`/api/settings/ai/models?task=fast&provider=${provider}`)
      .then((raw) => {
        const parsed = modelListSchema.safeParse(raw)
        if (!parsed.success) return
        setNotesModels(parsed.data.models.map((model) => model.id))
        if (parsed.data.providers) setNoteProviders(parsed.data.providers)
      })
      .catch(() => setNotesModels([]))
  }, [])

  const load = React.useCallback((): void => {
    apiFetch<unknown>("/api/settings/ai")
      .then(async (raw) => {
        const parsed = savedSchema.safeParse(raw)
        if (!parsed.success) {
          setError("Could not read meeting models")
          return
        }
        const savedListen = parsed.data.settings.models.meeting?.listen ?? null
        const savedNotes = parsed.data.settings.models.meeting?.notes ?? null
        setListen(savedListen)
        setNotes(savedNotes)
        const provider = savedListen?.provider ?? "openai"
        setListenProvider(provider)
        setListenModel(savedListen?.model ?? "whisper-1")
        if (provider === "custom") {
          const listed = await apiFetch<unknown>("/api/settings/ai/models?task=voice").catch(() => null)
          const models = modelListSchema.safeParse(listed)
          setListenModels(models.success ? models.data.models.map((model) => model.id) : [])
        } else {
          setListenModels([...OPENAI_LISTEN_MODELS])
        }
        const notesProviderId = savedNotes?.provider ?? "openai"
        setNotesProvider(notesProviderId)
        setNotesModel(savedNotes?.model ?? "")
        loadNotesModels(notesProviderId)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load models"))
      .finally(() => setLoading(false))
  }, [loadNotesModels])

  React.useEffect(() => {
    load()
  }, [load])

  async function saveListen(next: MeetingListenChoice | null): Promise<void> {
    setBusy("listen")
    try {
      await apiFetch("/api/settings/ai", {
        method: "PUT",
        body: JSON.stringify({ models: { meeting: { listen: next } } }),
      })
      toast.success(next ? "Listen model saved" : "Listen model cleared")
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(null)
    }
  }

  async function saveNotes(next: MeetingNotesChoice | null): Promise<void> {
    setBusy("notes")
    try {
      await apiFetch("/api/settings/ai", {
        method: "PUT",
        body: JSON.stringify({ models: { meeting: { notes: next } } }),
      })
      toast.success(next ? "Notes model saved" : "Notes model cleared")
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-destructive">{error}</span>
        <Button size="sm" variant="outline" onClick={() => { setLoading(true); load() }}>
          Retry
        </Button>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading models…</p>
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  const listenUnchanged =
    (listen?.provider ?? "openai") === listenProvider && (listen?.model ?? "whisper-1") === listenModel.trim()
  const notesUnchanged = (notes?.provider ?? "") === (notes ? notesProvider : "") && (notes?.model ?? "") === notesModel.trim()

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Meeting uses two models. Listen hears the audio. Notes writes the summary in the language of the call.
      </p>
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          Listen
          {listen ? null : <Badge variant="secondary">Default</Badge>}
        </Label>
        <p className="text-sm text-muted-foreground">{MEETING_LISTEN_HELP}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={listenProvider}
            onValueChange={(value: "openai" | "custom") => {
              setListenProvider(value)
              if (value === "openai") {
                setListenModels([...OPENAI_LISTEN_MODELS])
                setListenModel("whisper-1")
              } else {
                setListenModel("")
                void apiFetch<unknown>("/api/settings/ai/models?task=voice")
                  .then((raw) => {
                    const models = modelListSchema.safeParse(raw)
                    setListenModels(models.success ? models.data.models.map((model) => model.id) : [])
                  })
                  .catch(() => setListenModels([]))
              }
            }}
          >
            <SelectTrigger className="w-36" aria-label="Listen provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <ModelCombobox
            value={listenModel}
            onChange={setListenModel}
            models={listenModels}
            disabled={busy !== null}
            className="w-full sm:w-80"
          />
          <Button
            size="sm"
            disabled={!listenModel.trim() || listenUnchanged || busy !== null}
            onClick={() => void saveListen({ provider: listenProvider, model: listenModel.trim() })}
          >
            {busy === "listen" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          {listen ? (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void saveListen(null)}>
              <RotateCcw className="h-4 w-4" />
              Use default
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{LISTEN_COST}</p>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          Notes
          {notes ? null : <Badge variant="secondary">Assistant model</Badge>}
        </Label>
        <p className="text-sm text-muted-foreground">{MEETING_NOTES_HELP}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={notesProvider}
            onValueChange={(value: ProviderId) => {
              setNotesProvider(value)
              setNotesModel("")
              loadNotesModels(value)
            }}
          >
            <SelectTrigger className="w-36" aria-label="Notes provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(noteProviders.length > 0 ? noteProviders : [{ id: "openai" as const, label: "OpenAI" }]).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ModelCombobox
            value={notesModel}
            onChange={setNotesModel}
            models={notesModels}
            disabled={busy !== null}
            className="w-full sm:w-80"
          />
          <Button
            size="sm"
            disabled={!notesModel.trim() || notesUnchanged || busy !== null}
            onClick={() => void saveNotes({ provider: notesProvider, model: notesModel.trim() })}
          >
            {busy === "notes" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          {notes ? (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void saveNotes(null)}>
              <RotateCcw className="h-4 w-4" />
              Use Assistant model
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
