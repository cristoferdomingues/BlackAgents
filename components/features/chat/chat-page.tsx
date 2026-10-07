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
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { streamPost, type SseEvent } from "@/lib/sse-client"
import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import {
  activeMentionQuery,
  filterMentions,
  insertMention,
} from "@/lib/artifacts/mentions"
import {
  DRAFT_STORAGE_KEY,
  extractDraft,
  stripDraftBlock,
  type NormalizedDraft,
} from "@/lib/llm/draft"
import { extractBundle, stripBundleBlock } from "@/lib/llm/bundle"
import {
  chatApprovalRequiredEventSchema,
  chatApprovalResolvedEventSchema,
  chatContextEventSchema,
  chatDoneEventSchema,
  chatErrorEventSchema,
  chatTokenEventSchema,
  chatToolResultEventSchema,
} from "@/lib/assistant/chat-events"
import type { TurnArtifact } from "@/lib/assistant/turn-artifacts"
import type { ApprovalRequest, ToolExecutionTrace } from "@/lib/runtime/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MentionMenu, type ChatMention } from "@/components/features/chat/mention-menu"
import { ModelCombobox } from "@/components/features/chat/model-combobox"
import {
  AgentAvatar,
  DraftCard,
  ToolExecutionsSection,
} from "@/components/features/chat/message-parts"
import { BundleCard } from "@/components/features/chat/bundle-card"
import { FeedbackBar } from "@/components/features/chat/feedback-bar"
import { ApprovalCard } from "@/components/features/approvals/approval-card"
import {
  isProviderVerified,
  type ProvidersState,
} from "@/components/features/providers/provider-readiness"

interface Turn {
  role: "user" | "assistant"
  content: string
  toolExecutions?: ToolExecutionTrace[]
  artifacts?: TurnArtifact[]
  stoppedAtLimit?: boolean
}

/** The assistant reply while it is still streaming. */
interface LiveTurn {
  content: string
  toolExecutions: ToolExecutionTrace[]
  approvals: ApprovalRequest[]
  artifacts: TurnArtifact[]
}

const EMPTY_LIVE: LiveTurn = { content: "", toolExecutions: [], approvals: [], artifacts: [] }

function applyEvent(live: LiveTurn, { event, data }: SseEvent): LiveTurn {
  switch (event) {
    case "context": {
      const parsed = chatContextEventSchema.safeParse(data)
      return parsed.success ? { ...live, artifacts: parsed.data.artifacts } : live
    }
    case "token": {
      const parsed = chatTokenEventSchema.safeParse(data)
      return parsed.success ? { ...live, content: parsed.data.content } : live
    }
    case "tool_result": {
      const parsed = chatToolResultEventSchema.safeParse(data)
      return parsed.success ? { ...live, toolExecutions: [...live.toolExecutions, parsed.data.trace] } : live
    }
    case "approval_required": {
      const parsed = chatApprovalRequiredEventSchema.safeParse(data)
      return parsed.success ? { ...live, approvals: [...live.approvals, parsed.data.approval] } : live
    }
    case "approval_resolved": {
      const parsed = chatApprovalResolvedEventSchema.safeParse(data)
      return parsed.success ? { ...live, approvals: live.approvals.filter((a) => a.id !== parsed.data.id) } : live
    }
    default:
      return live
  }
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
    artifacts,
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
  const [mcpToolsCount, setMcpToolsCount] = React.useState<number>(0)
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [input, setInput] = React.useState("")
  const [caret, setCaret] = React.useState(0)
  const [activeMentionIndex, setActiveMentionIndex] = React.useState(0)
  const [dismissedMentionKey, setDismissedMentionKey] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const [sending, setSending] = React.useState(false)
  const [live, setLive] = React.useState<LiveTurn>(EMPTY_LIVE)
  const [allowWrites, setAllowWrites] = React.useState(false)
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
    if (!workspace?.path) {
      setMcpToolsCount(0)
      return
    }
    apiFetch<{ totalTools: number }>("/api/mcp")
      .then((res) => setMcpToolsCount(res.totalTools ?? 0))
      .catch(() => setMcpToolsCount(0))
  }, [workspace?.path])

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
    setCaret(0)
    setSending(true)
    setLive(EMPTY_LIVE)
    try {
      let current = EMPTY_LIVE
      const outcome: { final: Turn | null; error: string | null } = {
        final: null,
        error: null,
      }
      await streamPost(
        "/api/chat",
        {
          provider,
          model,
          messages: next.map(({ role, content: c }) => ({ role, content: c })),
          agent: selectedAgent?.name,
          allowWrites,
        },
        (event) => {
          if (event.event === "done") {
            const parsed = chatDoneEventSchema.safeParse(event.data)
            if (!parsed.success) {
              outcome.error = "The assistant sent an unreadable reply"
              return
            }
            const data = parsed.data
            outcome.final = {
              role: "assistant",
              content: data.content,
              toolExecutions: data.toolExecutions?.length ? data.toolExecutions : undefined,
              artifacts: current.artifacts.length ? current.artifacts : undefined,
              stoppedAtLimit: data.stoppedAtLimit,
            }
            return
          }
          if (event.event === "error") {
            const parsed = chatErrorEventSchema.safeParse(event.data)
            outcome.error = parsed.success ? parsed.data.message : "The assistant failed"
            return
          }
          current = applyEvent(current, event)
          setLive(current)
        }
      )
      if (outcome.error) throw new Error(outcome.error)
      const reply = outcome.final
      if (!reply) throw new Error("The assistant stopped before answering")
      setTurns((t) => [...t, reply])
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
      setLive(EMPTY_LIVE)
    }
  }

  function openInEditor(draft: NormalizedDraft) {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
    router.push(`/${metaForType(draft.type).route}/new`)
  }

  const mention = activeMentionQuery(input, caret)
  const mentionKey = mention ? `${mention.start}:${mention.query}` : ""
  const [mentionKeySeen, setMentionKeySeen] = React.useState(mentionKey)
  if (mentionKey !== mentionKeySeen) {
    setMentionKeySeen(mentionKey)
    setActiveMentionIndex(0)
  }
  const mentionItems = filterMentions(
    artifacts.map((artifact) => ({
      type: artifact.type,
      name: artifact.name,
      description: artifact.description,
    })),
    mention?.query ?? ""
  )
  const mentionOpen = mention !== null && dismissedMentionKey !== mentionKey && !sending
  const mentionIndex =
    mentionItems.length === 0 ? 0 : activeMentionIndex % mentionItems.length

  function rememberCaret(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? element.value.length)
  }

  function pickMention(item: ChatMention) {
    if (!mention) return
    const next = insertMention(input, caret, mention, item.type, item.name)
    setInput(next.text)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen && mentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveMentionIndex((index) => (index + 1) % mentionItems.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveMentionIndex((index) => (index - 1 + mentionItems.length) % mentionItems.length)
        return
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault()
        const item = mentionItems[mentionIndex]
        if (item) pickMention(item)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setDismissedMentionKey(mentionKey)
        return
      }
    }
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
          {mcpToolsCount > 0 ? (
            <Link
              href="/settings"
              title={`${mcpToolsCount} MCP ${mcpToolsCount === 1 ? "tool" : "tools"} loaded in this workspace. Click to manage in Settings.`}
            >
              <Badge
                variant="outline"
                className="gap-1 border-primary/30 bg-primary/5 text-primary text-xs hover:bg-primary/10 transition-colors"
              >
                <Wrench className="h-3 w-3" />
                <span>
                  {mcpToolsCount} {mcpToolsCount === 1 ? "tool" : "tools"}
                </span>
              </Badge>
            </Link>
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
          <div className="flex items-center gap-2">
            <Switch
              id="chat-allow-writes"
              checked={allowWrites}
              onCheckedChange={setAllowWrites}
              disabled={sending}
            />
            <Label htmlFor="chat-allow-writes" className="text-xs text-muted-foreground">
              Allow file writes
            </Label>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
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
                previousUser={turns[i - 1]?.role === "user" ? turns[i - 1].content : ""}
                provider={provider}
                model={model}
              />
            ))
          )}
          {sending ? (
            <div className="space-y-3">
              {live.artifacts.length > 0 ? <LoadedArtifacts artifacts={live.artifacts} /> : null}
              {live.toolExecutions.length > 0 ? (
                <ToolExecutionsSection traces={live.toolExecutions} />
              ) : null}
              {live.approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  rememberLabel="Allow this exact call for this message"
                />
              ))}
              {live.content ? (
                <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
                  <MarkdownPreview content={stripBundleBlock(stripDraftBlock(live.content))} />
                </div>
              ) : null}
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground"
                aria-hidden="true"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {live.approvals.length > 0
                  ? "Waiting for your approval…"
                  : selectedAgent
                    ? `${selectedAgent.name} is thinking…`
                    : "Thinking…"}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t p-4">
        <div className="relative mx-auto flex w-full max-w-6xl items-end gap-2">
          {mentionOpen ? (
            <MentionMenu
              items={mentionItems}
              activeIndex={mentionIndex}
              emptyLabel={
                loadingArtifacts
                  ? "Loading artifacts…"
                  : workspace
                    ? "No matching artifacts"
                    : "Open a workspace to mention artifacts"
              }
              onPick={pickMention}
              onHighlight={setActiveMentionIndex}
            />
          ) : null}
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              rememberCaret(e.target)
            }}
            onSelect={(e) => rememberCaret(e.currentTarget)}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => rememberCaret(e.currentTarget)}
            aria-autocomplete="list"
            aria-expanded={mentionOpen}
            aria-controls={mentionOpen ? "assistant-mentions" : undefined}
            aria-activedescendant={
              mentionOpen && mentionItems.length > 0
                ? `assistant-mention-${mentionIndex}`
                : undefined
            }
            rows={4}
            placeholder={
              agentNotFound
                ? "Choose an available agent to start chatting"
                : providerVerified
                  ? selectedAgent
                    ? `Message ${selectedAgent.name}…`
                    : "Describe an agent, command, rule, or skill…"
                  : "Verify a provider to start chatting"
            }
            className="max-h-52 min-h-28 resize-none"
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

function LoadedArtifacts({ artifacts }: { artifacts: TurnArtifact[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>Context:</span>
      {artifacts.map((a) => (
        <Badge
          key={`${a.type}:${a.name}`}
          variant="outline"
          className="gap-1 font-normal"
          title={
            a.source === "auto"
              ? "Picked by Jev for this message"
              : a.source === "linked"
                ? "Linked from a loaded artifact"
                : "Mentioned in your message"
          }
        >
          {metaForType(a.type).label.toLowerCase()}/{a.name}
          <span className="text-[10px] opacity-70">{a.source}</span>
        </Badge>
      ))}
    </div>
  )
}

function Message({
  turn,
  onOpen,
  agentName,
  previousUser,
  provider,
  model,
}: {
  turn: Turn
  onOpen: (draft: NormalizedDraft) => void
  agentName?: string
  previousUser: string
  provider: string
  model: string
}) {
  const isUser = turn.role === "user"
  const bundle = isUser ? null : extractBundle(turn.content)
  const draft = isUser || bundle ? null : extractDraft(turn.content)
  const prose = isUser ? turn.content : stripBundleBlock(stripDraftBlock(turn.content))

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
      <div
        className={cn(
          "min-w-0 space-y-3",
          isUser ? "max-w-[85%] text-right" : "w-full"
        )}
      >
        {isUser ? (
          <div className="inline-block whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
            {turn.content}
          </div>
        ) : (
          <>
            {turn.artifacts && turn.artifacts.length > 0 ? (
              <LoadedArtifacts artifacts={turn.artifacts} />
            ) : null}
            {turn.toolExecutions && turn.toolExecutions.length > 0 ? (
              <ToolExecutionsSection traces={turn.toolExecutions} />
            ) : null}
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <MarkdownPreview content={prose || "…"} />
            </div>
            {turn.stoppedAtLimit ? (
              <p className="text-xs text-muted-foreground">
                Stopped at the tool-call limit. You can raise it in Settings.
              </p>
            ) : null}
          </>
        )}

        {draft ? <DraftCard draft={draft} onOpen={onOpen} /> : null}
        {bundle ? <BundleCard bundle={bundle} /> : null}
        {!isUser ? (
          <FeedbackBar
            source="chat"
            agent={agentName}
            userMessage={previousUser}
            reply={turn.content}
            provider={provider}
            model={model}
          />
        ) : null}
      </div>
    </div>
  )
}
