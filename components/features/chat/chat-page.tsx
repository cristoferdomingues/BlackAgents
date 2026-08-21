"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Loader2,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  User,
  Wand2,
} from "lucide-react"
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
import {
  isProviderVerified,
  type ProvidersState,
} from "@/components/features/providers/provider-readiness"

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

export function ChatPage({
  selectedAgentName,
}: {
  selectedAgentName?: string
}) {
  const router = useRouter()
  const {
    workspace,
    byType,
    loading: workspaceLoading,
    loadingArtifacts,
  } = useWorkspace()
  const [meta, setMeta] = React.useState<ProvidersState | null>(null)
  const [metaLoading, setMetaLoading] = React.useState(true)
  const [metaError, setMetaError] = React.useState<string | null>(null)
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
  const agents = byType("agent")
  const selectedAgent = selectedAgentName
    ? agents.find((agent) => agent.name === selectedAgentName)
    : undefined
  const agentNotFound = Boolean(
    selectedAgentName &&
      !workspaceLoading &&
      !loadingArtifacts &&
      !selectedAgent
  )
  const suggestions = selectedAgent
    ? [
        `What kinds of tasks are you best suited for as ${selectedAgent.name}?`,
        `Help me with a task using your ${selectedAgent.name} persona.`,
        `Guide me through this goal: ${selectedAgent.description}`,
      ]
    : SUGGESTIONS

  React.useEffect(() => {
    apiFetch<ProvidersState>("/api/providers")
      .then((data) => {
        setMeta(data)
        const verified = data.status
          .filter((status) => status.verificationStatus === "valid")
          .map((status) => status.id)
        const remembered = readStored(LAST_PROVIDER_KEY)
        // Prefer durable secrets defaults over localStorage. Electron assigns a
        // new 127.0.0.1 port each launch, so localStorage is a new empty origin.
        const initial =
          (data.defaults.provider &&
          verified.includes(data.defaults.provider)
            ? data.defaults.provider
            : null) ??
          (remembered && verified.includes(remembered)
            ? remembered
            : null) ??
          verified[0] ??
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
      .catch((err) => {
        setMetaError(
          err instanceof Error ? err.message : "Could not load providers"
        )
      })
      .finally(() => setMetaLoading(false))
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

  const providerVerified = isProviderVerified(meta, provider)
  const hasVerifiedProvider = Boolean(
    meta?.status.some((status) => status.verificationStatus === "valid")
  )
  const canChat = providerVerified && !agentNotFound

  // Load selectable models for the active verified provider.
  React.useEffect(() => {
    if (!provider || !providerVerified) {
      return
    }
    let cancelled = false

    async function loadModels(): Promise<void> {
      await Promise.resolve()
      const staticModels =
        meta?.providers.find((p) => p.id === provider)?.models ?? []
      setAvailableModels(staticModels)
      setModelsLoading(true)
      try {
        const data = await apiFetch<{ models: string[] }>(
          `/api/providers/models?id=${encodeURIComponent(provider)}`
        )
        if (!cancelled) setAvailableModels(data.models)
      } catch {
        // Keep the curated static list already shown.
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [provider, meta, providerVerified])

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
    if (agentNotFound) {
      toast.error(`Agent "${selectedAgentName}" was not found`)
      return
    }
    if (!providerVerified) {
      toast.error("Verify this provider before starting a chat")
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
          body: JSON.stringify({
            provider,
            model,
            messages: next,
            agent: selectedAgent?.name,
          }),
        }
      )
      setTurns((t) => [...t, { role: "assistant", content: result.content }])
      // The model id was accepted — remember it for the next launch.
      await persistSelection(provider, model)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The assistant failed")
      setTurns((t) => t.slice(0, -1))
      setInput(content)
      apiFetch<ProvidersState>("/api/providers")
        .then(setMeta)
        .catch(() => {
          // Preserve the current controls when status refresh is unavailable.
        })
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
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {sending
          ? `${selectedAgent?.name ?? "Assistant"} is thinking`
          : turns.at(-1)?.role === "assistant"
            ? `${selectedAgent?.name ?? "Assistant"} responded`
            : ""}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Assistant</h1>
          {selectedAgent ? (
            <Badge
              variant="secondary"
              className="max-w-52 gap-1.5 truncate"
              title={selectedAgent.description}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {selectedAgent.name}
            </Badge>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-initial">
          <Select
            value={provider}
            onValueChange={selectProvider}
            disabled={metaLoading || Boolean(metaError)}
          >
            <SelectTrigger className="w-36 sm:w-40" aria-label="Provider">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {meta?.providers.map((p) => {
                const verificationStatus = meta.status.find(
                  (status) => status.id === p.id
                )?.verificationStatus
                return (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                    {verificationStatus === "valid"
                      ? ""
                      : verificationStatus === "invalid"
                        ? " (invalid)"
                        : " (unverified)"}
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
            disabled={!providerVerified}
            className="w-52 sm:w-64"
          />
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {metaError ? (
            <div
              className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <div className="flex gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium">Providers unavailable</p>
                  <p className="text-xs text-muted-foreground">{metaError}</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {agentNotFound ? (
            <div
              className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <div className="flex gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium">Agent not found</p>
                  <p className="text-xs text-muted-foreground">
                    The agent “{selectedAgentName}” is not available in this
                    workspace. It may have been renamed or removed.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/agents">View agents</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/chat">Open generic chat</Link>
                </Button>
              </div>
            </div>
          ) : null}
          {!metaLoading && !metaError && !hasVerifiedProvider ? (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    Verify a provider to start chatting
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Chat stays disabled until a saved provider passes a live
                    credential check.
                  </p>
                </div>
              </div>
              <Button asChild size="sm">
                <Link href="/providers">Open providers</Link>
              </Button>
            </div>
          ) : !metaLoading &&
            !metaError &&
            hasVerifiedProvider &&
            !providerVerified ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">
                This provider is not verified. Choose a verified provider or{" "}
                <Link href="/providers" className="text-primary underline">
                  verify it
                </Link>
                .
              </p>
            </div>
          ) : null}
          {turns.length === 0 ? (
            <div className="space-y-6 py-10 text-center">
              <div className="space-y-3">
                {selectedAgent ? (
                  <AgentAvatar name={selectedAgent.name} className="mx-auto" />
                ) : null}
                <h2 className="text-xl font-semibold">
                  {selectedAgent
                    ? `Chat with ${selectedAgent.name}`
                    : "Describe the artifact you want"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {selectedAgent
                    ? selectedAgent.description
                    : `The assistant follows your authoring standards${
                        workspace
                          ? ` and knows the artifacts in ${workspace.name}`
                          : ""
                      }. When it proposes one, open it straight in the editor.`}
                </p>
              </div>
              <div className="flex flex-col items-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={!canChat || sending}
                    className="w-full max-w-md rounded-md border px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn, i) => (
              <Message
                key={i}
                turn={turn}
                onOpen={openInEditor}
                agentName={selectedAgent?.name}
              />
            ))
          )}
          {sending ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              aria-hidden="true"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {selectedAgent
                ? `${selectedAgent.name} is thinking…`
                : "Thinking…"}
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
              agentNotFound
                ? "Choose an available agent to start chatting"
                : providerVerified
                  ? selectedAgent
                    ? `Message ${selectedAgent.name}…`
                    : "Describe an agent, command, rule, or skill…"
                  : "Verify a provider to start chatting"
            }
            className="max-h-40 min-h-[2.75rem] resize-none"
            disabled={!canChat || sending}
            aria-label={
              selectedAgent
                ? `Message ${selectedAgent.name}`
                : "Message assistant"
            }
          />
          <Button
            size="icon"
            onClick={() => send(input)}
            disabled={!canChat || sending || !input.trim()}
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
  agentName,
}: {
  turn: Turn
  onOpen: (draft: NormalizedDraft) => void
  agentName?: string
}) {
  const isUser = turn.role === "user"
  const draft = isUser ? null : extractDraft(turn.content)
  const prose = isUser ? turn.content : stripDraftBlock(turn.content)

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {isUser ? (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <User className="h-4 w-4" />
        </div>
      ) : agentName ? (
        <AgentAvatar name={agentName} />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="h-4 w-4" />
        </div>
      )}
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

function AgentAvatar({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20",
        className
      )}
      aria-label={`${name} avatar`}
      title={name}
    >
      <span className="text-xs font-semibold" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
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
