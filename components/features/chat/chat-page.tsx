"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUp, Bot, Loader2, Sparkles, User, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import {
  DRAFT_STORAGE_KEY,
  extractDraft,
  stripDraftBlock,
  type NormalizedDraft,
} from "@/lib/llm/draft"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ModelCombobox } from "@/components/features/chat/model-combobox"

interface ProviderDescriptor {
  id: string
  label: string
  models: string[]
  requiresBaseUrl: boolean
}

interface ProviderStatus {
  id: string
  configured: boolean
}

interface ProvidersState {
  providers: ProviderDescriptor[]
  status: ProviderStatus[]
  defaults: { provider?: string; model?: string }
}

interface Turn {
  role: "user" | "assistant"
  content: string
}

const SUGGESTIONS = [
  "Create a rule that enforces conventional commit messages.",
  "Design an agent that reviews PRs for security issues.",
  "Write a command that orchestrates a release workflow.",
]

// Remember the last provider + the last model id per provider, so the pickers
// (especially the custom free-text model id) come back prefilled next time.
const LAST_PROVIDER_KEY = "black-agents:last-provider"
const lastModelKey = (provider: string) => `black-agents:last-model:${provider}`

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage may be unavailable (private mode) — non-fatal
  }
}

/**
 * Persist the Assistant selection to localStorage (same-origin browser cache)
 * and to ~/.black-agents/secrets.json defaults (durable across Electron
 * restarts, which use a fresh loopback port / origin each launch).
 */
async function persistSelection(
  nextProvider: string,
  nextModel: string
): Promise<void> {
  if (!nextProvider) return
  writeStored(LAST_PROVIDER_KEY, nextProvider)
  if (nextModel) writeStored(lastModelKey(nextProvider), nextModel)
  try {
    await apiFetch<ProvidersState>("/api/providers", {
      method: "PUT",
      body: JSON.stringify({
        provider: nextProvider,
        model: nextModel || undefined,
      }),
    })
  } catch {
    // localStorage still helps in the browser; Electron relies on the API
  }
}

export function ChatPage() {
  const router = useRouter()
  const { workspace } = useWorkspace()
  const [meta, setMeta] = React.useState<ProvidersState | null>(null)
  const [provider, setProvider] = React.useState<string>("")
  const [model, setModel] = React.useState<string>("")
  const [availableModels, setAvailableModels] = React.useState<string[]>([])
  const [modelsLoading, setModelsLoading] = React.useState(false)
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  // Skip the first persist after hydration so we don't rewrite unchanged
  // defaults while restoring the previous selection.
  const selectionReady = React.useRef(false)
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    apiFetch<ProvidersState>("/api/providers")
      .then((data) => {
        setMeta(data)
        const configured = data.status.filter((s) => s.configured).map((s) => s.id)
        const remembered = readStored(LAST_PROVIDER_KEY)
        // Prefer durable secrets defaults over localStorage. Electron assigns a
        // new 127.0.0.1 port each launch, so localStorage is a new empty origin.
        const initial =
          (data.defaults.provider &&
          data.providers.some((p) => p.id === data.defaults.provider)
            ? data.defaults.provider
            : null) ??
          (remembered && data.providers.some((p) => p.id === remembered)
            ? remembered
            : null) ??
          configured[0] ??
          data.providers[0]?.id
        if (initial) {
          setProvider(initial)
          const desc = data.providers.find((p) => p.id === initial)
          const defaultModel =
            initial === data.defaults.provider ? data.defaults.model : ""
          const storedModel = readStored(lastModelKey(initial))
          setModel(defaultModel || storedModel || desc?.models[0] || "")
        }
        selectionReady.current = true
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns, sending])

  // Debounce durable persistence while the user types a custom model id.
  React.useEffect(() => {
    if (!selectionReady.current || !provider) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      void persistSelection(provider, model)
    }, 400)
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [provider, model])

  // Load selectable models for the active provider (static + live when possible).
  React.useEffect(() => {
    if (!provider) {
      setAvailableModels([])
      return
    }
    const staticModels =
      meta?.providers.find((p) => p.id === provider)?.models ?? []
    setAvailableModels(staticModels)
    let cancelled = false
    setModelsLoading(true)
    apiFetch<{ models: string[] }>(
      `/api/providers/models?id=${encodeURIComponent(provider)}`
    )
      .then((data) => {
        if (!cancelled) setAvailableModels(data.models)
      })
      .catch(() => {
        // Keep the curated static list already shown.
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [provider, meta])

  const configured = Boolean(
    meta?.status.find((s) => s.id === provider)?.configured
  )

  function selectProvider(id: string) {
    setProvider(id)
    const desc = meta?.providers.find((p) => p.id === id)
    const nextModel =
      (meta?.defaults.provider === id ? meta.defaults.model : "") ||
      readStored(lastModelKey(id)) ||
      desc?.models[0] ||
      ""
    setModel(nextModel)
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || sending) return
    if (!configured) {
      toast.error("Add an API key for this provider first")
      return
    }
    const next = [...turns, { role: "user" as const, content }]
    setTurns(next)
    setInput("")
    setSending(true)
    try {
      const result = await apiFetch<{ content: string; model: string }>(
        "/api/chat",
        {
          method: "POST",
          body: JSON.stringify({ provider, model, messages: next }),
        }
      )
      setTurns((t) => [...t, { role: "assistant", content: result.content }])
      // The model id was accepted — remember it for the next launch.
      await persistSelection(provider, model)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The assistant failed")
      setTurns((t) => t.slice(0, -1))
      setInput(content)
    } finally {
      setSending(false)
    }
  }

  function openInEditor(draft: NormalizedDraft) {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
    router.push(`/${metaForType(draft.type).route}/new`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Assistant</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={provider} onValueChange={selectProvider}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {meta?.providers.map((p) => {
                const ready = meta.status.find((s) => s.id === p.id)?.configured
                return (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                    {ready ? "" : " (no key)"}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <ModelCombobox
            value={model}
            onChange={setModel}
            models={availableModels}
            loading={modelsLoading}
          />
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {turns.length === 0 ? (
            <div className="space-y-6 py-10 text-center">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">
                  Describe the artifact you want
                </h2>
                <p className="text-sm text-muted-foreground">
                  The assistant follows your authoring standards
                  {workspace ? ` and knows the artifacts in ${workspace.name}` : ""}.
                  When it proposes one, open it straight in the editor.
                </p>
              </div>
              <div className="flex flex-col items-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="w-full max-w-md rounded-md border px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
              {!configured ? (
                <p className="text-xs text-muted-foreground">
                  No key for this provider yet.{" "}
                  <Link href="/providers" className="text-primary underline">
                    Add one
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          ) : (
            turns.map((turn, i) => (
              <Message key={i} turn={turn} onOpen={openInEditor} />
            ))
          )}
          {sending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              configured
                ? "Describe an agent, command, rule, or skill…"
                : "Add an API key to start chatting"
            }
            className="max-h-40 min-h-[2.75rem] resize-none"
            disabled={!configured || sending}
          />
          <Button
            size="icon"
            onClick={() => send(input)}
            disabled={!configured || sending || !input.trim()}
            aria-label="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Message({
  turn,
  onOpen,
}: {
  turn: Turn
  onOpen: (draft: NormalizedDraft) => void
}) {
  const isUser = turn.role === "user"
  const draft = isUser ? null : extractDraft(turn.content)
  const prose = isUser ? turn.content : stripDraftBlock(turn.content)

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={cn("min-w-0 max-w-[85%] space-y-3", isUser && "text-right")}>
        {isUser ? (
          <div className="inline-block whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
            {turn.content}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <MarkdownPreview content={prose || "…"} />
          </div>
        )}

        {draft ? <DraftCard draft={draft} onOpen={onOpen} /> : null}
      </div>
    </div>
  )
}

function DraftCard({
  draft,
  onOpen,
}: {
  draft: NormalizedDraft
  onOpen: (draft: NormalizedDraft) => void
}) {
  const meta = metaForType(draft.type)
  const Icon = meta.icon
  return (
    <div className="rounded-lg border bg-card p-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", meta.colorClass)} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{draft.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {draft.description}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {meta.label}
        </Badge>
      </div>
      <Button
        size="sm"
        className="mt-3 w-full"
        onClick={() => onOpen(draft)}
      >
        <Wand2 className="h-4 w-4" />
        Open in editor
      </Button>
    </div>
  )
}
