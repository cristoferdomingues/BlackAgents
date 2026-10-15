"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ArrowUp,
  Bot,
  FileImage,
  FileText,
  FolderOpen,
  Youtube,
  History,
  Loader2,
  MessageCircle,
  Mic,
  Paperclip,
  Plus,
  ShieldAlert,
  Sparkles,
  Square,
  User,
  Wrench,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { streamPost } from "@/lib/sse-client"
import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import { withBuiltinArtifacts } from "@/lib/artifacts/builtin"
import {
  activeMentionQuery,
  filterMentions,
  insertMention,
  mentionMatches,
} from "@/lib/artifacts/mentions"
import {
  ATTACHMENT_ACCEPT,
  AttachmentError,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  attachmentMeta,
  describeMissingAttachments,
  formatBytes,
  readFileAsAttachment,
  totalAttachmentBytes,
  type Attachment,
  type AttachmentMeta,
  type YouTubeAttachment,
} from "@/lib/chat/attachments"
import { YouTubeLinkButton } from "@/components/features/chat/youtube-link-dialog"
import { FilePickerDialog } from "@/components/features/files/file-picker"
import type { WorkspaceFile } from "@/lib/files/schema"
import {
  extractWorkflowDraft,
  stripWorkflowBlock,
} from "@/lib/llm/workflow-draft"
import { parseWorkflowInvocation } from "@/lib/workflows/invocation"
import type { WorkflowListItem } from "@/lib/workflows/service"
import { useVoiceInput } from "@/hooks/use-voice-input"
import {
  DRAFT_STORAGE_KEY,
  extractDraft,
  stripDraftBlock,
  type NormalizedDraft,
} from "@/lib/llm/draft"
import { extractBundle, stripBundleBlock } from "@/lib/llm/bundle"
import { inspectModelRef, type ModelRef } from "@/lib/llm/model-ref"
import {
  type ChatContextModel,
  chatDoneEventSchema,
  chatErrorEventSchema,
} from "@/lib/assistant/chat-events"
import { applyChatEvent, EMPTY_LIVE, type LiveTurn } from "@/lib/assistant/live-turn"
import type { TurnArtifact } from "@/lib/assistant/turn-artifacts"
import type { AiSettings } from "@/lib/settings"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MentionMenu, type ChatMention } from "@/components/features/chat/mention-menu"
import { ModelCombobox } from "@/components/features/chat/model-combobox"
import { agentHeaderSummary } from "@/components/features/models/model-choice"
import {
  AgentAvatar,
  DraftCard,
  ToolExecutionsSection,
} from "@/components/features/chat/message-parts"
import { BundleCard } from "@/components/features/chat/bundle-card"
import { ThinkingPanel } from "@/components/features/chat/thinking-panel"
import { FeedbackBar } from "@/components/features/chat/feedback-bar"
import { WorkflowDraftCard } from "@/components/features/chat/workflow-draft-card"
import { WorkflowRunCard } from "@/components/features/chat/workflow-run-card"
import { ApprovalCard } from "@/components/features/approvals/approval-card"
import {
  isProviderVerified,
  type ProvidersState,
} from "@/components/features/providers/provider-readiness"
import {
  createConversationId,
  getConversation,
  readConversationsStore,
  setActiveConversation,
  upsertConversation,
  writeConversationsStore,
  type ChatTurn,
  type StoredConversation,
} from "@/lib/chat/conversation-history"

type Turn = ChatTurn

/** What the model sees for a turn; workflow-run turns stay local to the chat. */
function toRequestMessage(turn: Turn): {
  role: Turn["role"]
  content: string
  attachments?: Attachment[]
} {
  if (turn.files && turn.files.length > 0) {
    return { role: turn.role, content: turn.content, attachments: turn.files }
  }
  return { role: turn.role, content: turn.content + describeMissingAttachments(turn.attachments ?? []) }
}

function turnAttachments(turn: Turn): AttachmentMeta[] {
  return turn.files?.map(attachmentMeta) ?? turn.attachments ?? []
}

const SUGGESTIONS = [
  "Create a rule that enforces conventional commit messages.",
  "Design an agent that reviews PRs for security issues.",
  "Write a command that orchestrates a release workflow.",
  "Help me design a multi-step Workflow with a daily schedule.",
  "Guide me on setting up Automated Browsing and recording a browser flow.",
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
  const agentKey = selectedAgentName ?? ""
  const [resolvedModel, setResolvedModel] = React.useState<{
    agentKey: string
    model: ChatContextModel | null
  }>({ agentKey, model: null })
  const [availableModels, setAvailableModels] = React.useState<string[]>([])
  const [modelsLoading, setModelsLoading] = React.useState(false)
  const [mcpToolsCount, setMcpToolsCount] = React.useState<number>(0)
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [conversationId, setConversationId] = React.useState(() => createConversationId())
  const [recentConversations, setRecentConversations] = React.useState<StoredConversation[]>([])
  const [historyReady, setHistoryReady] = React.useState(false)
  const [input, setInput] = React.useState("")
  const [caret, setCaret] = React.useState(0)
  const [activeMentionIndex, setActiveMentionIndex] = React.useState(0)
  const [dismissedMentionKey, setDismissedMentionKey] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const [sending, setSending] = React.useState(false)
  const [live, setLive] = React.useState<LiveTurn>(EMPTY_LIVE)
  const [allowFileWrites, setAllowFileWrites] = React.useState(false)
  const [settingsAutoFileWrites, setSettingsAutoFileWrites] = React.useState(false)
  const [files, setFiles] = React.useState<Attachment[]>([])
  const [readingFiles, setReadingFiles] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [workflows, setWorkflows] = React.useState<WorkflowListItem[]>([])
  const [workspaceFiles, setWorkspaceFiles] = React.useState<WorkspaceFile[]>([])
  const voiceBaseRef = React.useRef("")
  const voice = useVoiceInput({
    provider,
    onTranscript: (text) => {
      const base = voiceBaseRef.current
      const next = base && text ? `${base.replace(/\s+$/, "")} ${text}` : base || text
      setInput(next)
      setCaret(next.length)
    },
  })
  const scrollRef = React.useRef<HTMLDivElement>(null)
  // Skip the first persist after hydration so we don't rewrite unchanged
  // defaults while restoring the previous selection.
  const selectionReady = React.useRef(false)
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const conversationIdRef = React.useRef(conversationId)
  conversationIdRef.current = conversationId
  const allArtifacts = React.useMemo(() => withBuiltinArtifacts(artifacts), [artifacts])
  const agents = React.useMemo(
    () => allArtifacts.filter((artifact) => artifact.type === "agent"),
    [allArtifacts]
  )
  const selectedAgent = selectedAgentName
    ? agents.find((agent) => agent.name === selectedAgentName)
    : undefined
  const agentNotFound = Boolean(
    selectedAgentName &&
      !workspaceLoading &&
      !loadingArtifacts &&
      !selectedAgent
  )
  const agentRef: ModelRef = React.useMemo(() => {
    if (!selectedAgent) return { kind: "inherit" }
    const inspected = inspectModelRef(selectedAgent.frontmatter.model, selectedAgent.frontmatter.provider)
    return inspected.error ? { kind: "inherit" } : inspected.ref
  }, [selectedAgent])
  const agentLocksModel = agentRef.kind === "id" || agentRef.kind === "task"
  const shownResolved = resolvedModel.agentKey === agentKey ? resolvedModel.model : null
  const agentSummary = agentLocksModel ? agentHeaderSummary(agentRef, shownResolved) : null
  const pickerModel =
    agentLocksModel && shownResolved
      ? shownResolved.model
      : agentLocksModel && agentRef.kind === "id"
        ? agentRef.model
        : model

  const suggestions = selectedAgent
    ? [
        `What kinds of tasks are you best suited for as ${selectedAgent.name}?`,
        `Help me with a task using your ${selectedAgent.name} persona.`,
        `Guide me through this goal: ${selectedAgent.description}`,
      ]
    : SUGGESTIONS

  React.useEffect(() => {
    let cancelled = false
    apiFetch<{ settings: AiSettings }>("/api/settings/ai")
      .then((data) => {
        if (!cancelled) setSettingsAutoFileWrites(data.settings.assistant.autoApproveFileWrites)
      })
      .catch(() => {
        if (!cancelled) setSettingsAutoFileWrites(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Restore the last matching conversation from localStorage (max 5 kept).
  React.useEffect(() => {
    const store = readConversationsStore()
    setRecentConversations(store.conversations)
    const active = store.activeId ? getConversation(store, store.activeId) : undefined
    const agentMatches =
      (active?.agent ?? undefined) === (selectedAgentName ?? undefined)
    if (active && active.messages.length > 0 && agentMatches) {
      setConversationId(active.id)
      setTurns(active.messages)
    } else {
      const id = createConversationId()
      setConversationId(id)
      writeConversationsStore(setActiveConversation(store, id))
    }
    setHistoryReady(true)
  }, [selectedAgentName])

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

  const loadWorkflows = React.useCallback(async (): Promise<void> => {
    try {
      const data = await apiFetch<{ workflows: WorkflowListItem[] }>("/api/workflows")
      setWorkflows(data.workflows)
    } catch {
      setWorkflows([])
    }
  }, [])

  React.useEffect(() => {
    if (!workspace?.path) {
      setWorkspaceFiles([])
      return
    }
    let cancelled = false
    apiFetch<{ workflows: WorkflowListItem[] }>("/api/workflows")
      .then((data) => {
        if (!cancelled) setWorkflows(data.workflows)
      })
      .catch(() => {
        if (!cancelled) setWorkflows([])
      })
    apiFetch<{ files: WorkspaceFile[] }>("/api/files")
      .then((data) => {
        if (!cancelled) setWorkspaceFiles(data.files)
      })
      .catch(() => {
        if (!cancelled) setWorkspaceFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [workspace?.path])

  React.useEffect(() => {
    const prefill = sessionStorage.getItem("black-agents:prefill-chat")
    if (!prefill) return
    sessionStorage.removeItem("black-agents:prefill-chat")
    setInput((current) => {
      const next = current ? `${current.replace(/\s+$/, "")} ${prefill}` : prefill
      setCaret(next.length)
      return next
    })
  }, [])

  React.useEffect(() => {
    if (voice.error) toast.error(voice.error)
  }, [voice.error])

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

  function saveTurns(nextTurns: Turn[]): void {
    const nextStore = upsertConversation(readConversationsStore(), {
      id: conversationIdRef.current,
      messages: nextTurns,
      agent: selectedAgent?.name,
      provider,
      model,
    })
    writeConversationsStore(nextStore)
    setRecentConversations(nextStore.conversations)
  }

  /** `/name input` or `start @name`: show a run card instead of asking the model. */
  function startWorkflowTurn(content: string): boolean {
    const invocation = parseWorkflowInvocation(
      content,
      workflows.map((item) => item.workflow.name)
    )
    if (!invocation) return false
    const workflow = workflows.find((item) => item.workflow.name === invocation.workflow)?.workflow
    const turn: Turn = {
      role: "user",
      content,
      workflowRun: { workflow: invocation.workflow, task: invocation.task || workflow?.task || "" },
    }
    const next = [...turns, turn]
    setTurns(next)
    saveTurns(next)
    setInput("")
    setCaret(0)
    return true
  }

  function markWorkflowStarted(index: number, runId: string, task: string): void {
    const next = turns.map((turn, i) =>
      i === index && turn.workflowRun
        ? { ...turn, workflowRun: { ...turn.workflowRun, runId, task } }
        : turn
    )
    setTurns(next)
    saveTurns(next)
  }

  function addYouTubeAttachment(attachment: YouTubeAttachment): void {
    if (files.some((file) => file.kind === "youtube" && file.videoId === attachment.videoId)) {
      toast.error("That video is already added")
      return
    }
    if (files.length >= MAX_ATTACHMENTS) {
      toast.error(`Attach at most ${MAX_ATTACHMENTS} files`)
      return
    }
    if (totalAttachmentBytes([...files, attachment]) > MAX_TOTAL_ATTACHMENT_BYTES) {
      toast.error(`Attachments can be at most ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} in total`)
      return
    }
    setFiles((current) => [...current, attachment])
  }

  async function addFiles(picked: File[]): Promise<void> {
    if (picked.length === 0) return
    setReadingFiles(true)
    try {
      let next = [...files]
      for (const file of picked) {
        if (next.length >= MAX_ATTACHMENTS) {
          toast.error(`Attach at most ${MAX_ATTACHMENTS} files`)
          break
        }
        try {
          const attachment = await readFileAsAttachment(file)
          if (totalAttachmentBytes([...next, attachment]) > MAX_TOTAL_ATTACHMENT_BYTES) {
            toast.error(`Attachments can be at most ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} in total`)
            continue
          }
          next = [...next, attachment]
        } catch (err) {
          toast.error(err instanceof AttachmentError ? err.message : `Could not attach "${file.name}"`)
        }
      }
      setFiles(next)
    } finally {
      setReadingFiles(false)
    }
  }

  function toggleVoice(): void {
    if (voice.state === "listening") {
      voice.stop()
      return
    }
    voiceBaseRef.current = input
    void voice.start()
  }

  async function send(text: string) {
    const content = text.trim()
    const sentFiles = files
    if ((!content && sentFiles.length === 0) || sending) return
    if (agentNotFound) {
      toast.error(`Agent "${selectedAgentName}" was not found`)
      return
    }
    if (sentFiles.length === 0 && startWorkflowTurn(content)) return
    if (!providerVerified) {
      toast.error("Verify this provider before starting a chat")
      return
    }
    const userTurn: Turn = sentFiles.length > 0
      ? { role: "user", content, files: sentFiles }
      : { role: "user", content }
    const next = [...turns, userTurn]
    setTurns(next)
    setInput("")
    setCaret(0)
    setFiles([])
    setSending(true)
    setResolvedModel({ agentKey, model: null })
    setLive(EMPTY_LIVE)
    let finished = false
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
          messages: next.filter((turn) => !turn.workflowRun).map(toRequestMessage),
          agent: selectedAgent?.name,
          allowFileWrites,
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
          current = applyChatEvent(current, event)
          if (current.model) setResolvedModel({ agentKey, model: current.model })
          setLive(current)
        }
      )
      if (outcome.error) throw new Error(outcome.error)
      const reply = outcome.final
      if (!reply) throw new Error("The assistant stopped before answering")
      const finalized = [...next, reply]
      setTurns(finalized)
      saveTurns(finalized)
      finished = true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The assistant failed")
      setTurns((t) => t.slice(0, -1))
      setInput(content)
      setFiles(sentFiles)
      apiFetch<ProvidersState>("/api/providers")
        .then(setMeta)
        .catch(() => {
          // Preserve the current controls when status refresh is unavailable.
        })
    } finally {
      setSending(false)
      setLive(EMPTY_LIVE)
    }
    if (finished) {
      // Remember the header picker only. An agent's model must not become the default.
      await persistSelection(provider, model)
    }
  }

  function openInEditor(draft: NormalizedDraft) {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
    const route = metaForType(draft.type).route
    const exists = artifacts.some(
      (artifact) => artifact.type === draft.type && artifact.name === draft.name
    )
    router.push(
      exists
        ? `/${route}/${encodeURIComponent(draft.name)}`
        : `/${route}/new`
    )
  }

  function startNewChat(): void {
    if (sending) return
    const id = createConversationId()
    const store = setActiveConversation(readConversationsStore(), id)
    writeConversationsStore(store)
    setConversationId(id)
    setTurns([])
    setInput("")
    setFiles([])
    setLive(EMPTY_LIVE)
    setAllowFileWrites(false)
    setRecentConversations(store.conversations)
  }

  function openRecentConversation(id: string): void {
    if (sending || id === conversationId) return
    const store = readConversationsStore()
    const convo = getConversation(store, id)
    if (!convo) return
    const next = setActiveConversation(store, id)
    writeConversationsStore(next)
    setRecentConversations(next.conversations)
    const target = convo.agent
      ? `/chat?agent=${encodeURIComponent(convo.agent)}`
      : "/chat"
    const current = selectedAgentName
      ? `/chat?agent=${encodeURIComponent(selectedAgentName)}`
      : "/chat"
    setAllowFileWrites(false)
    if (target !== current) {
      router.push(target)
      return
    }
    setConversationId(convo.id)
    setTurns(convo.messages)
    setInput("")
    setFiles([])
    setLive(EMPTY_LIVE)
  }

  const mention = activeMentionQuery(input, caret)
  const mentionKey = mention ? `${mention.start}:${mention.query}` : ""
  const [mentionKeySeen, setMentionKeySeen] = React.useState(mentionKey)
  if (mentionKey !== mentionKeySeen) {
    setMentionKeySeen(mentionKey)
    setActiveMentionIndex(0)
  }
  const mentionItems: ChatMention[] = [
    ...filterMentions(
      allArtifacts.map((artifact) => ({
        type: artifact.type,
        name: artifact.name,
        description: artifact.builtin
          ? `${artifact.description} (built-in)`
          : artifact.description,
      })),
      mention?.query ?? ""
    ),
    ...workflows
      .map(({ workflow }) => ({
        type: "workflow" as const,
        name: workflow.name,
        description: workflow.description,
      }))
      .filter((item) => mentionMatches(item, mention?.query ?? ""))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...workspaceFiles
      .map((file) => ({
        type: "file" as const,
        name: file.name,
        description: file.description
          ? `${file.originalName} — ${file.description}`
          : file.originalName,
      }))
      .filter((item) => mentionMatches(item, mention?.query ?? ""))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ]
  const mentionOpen = mention !== null && dismissedMentionKey !== mentionKey && !sending
  const mentionIndex =
    mentionItems.length === 0 ? 0 : activeMentionIndex % mentionItems.length

  function rememberCaret(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? element.value.length)
  }

  function insertFileToken(file: WorkspaceFile) {
    const token = `@file:${file.name}`
    setInput((current) => {
      const next = current.trim() ? `${current.replace(/\s+$/, "")} ${token} ` : `${token} `
      setCaret(next.length)
      return next
    })
    requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
    })
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={selectedAgent ? "secondary" : "outline"}
                size="sm"
                disabled={sending}
                aria-label="Switch assistant persona"
                className="h-7 max-w-56 gap-1.5 px-2.5 text-xs font-normal"
                title={selectedAgent ? selectedAgent.description : "Switch to a workspace or built-in agent"}
              >
                {selectedAgent ? (
                  <>
                    <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{selectedAgent.name}</span>
                  </>
                ) : (
                  <>
                    <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-muted-foreground">All modules</span>
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Persona</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => router.push("/chat")}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium">Generic Assistant</span>
                <span className="text-xs text-muted-foreground">
                  Authoring assistant for agents, skills, rules, commands, and workflows
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Built-in BlackAgents Guides</DropdownMenuLabel>
              {agents
                .filter((a) => a.builtin)
                .map((agent) => (
                  <DropdownMenuItem
                    key={agent.name}
                    onSelect={() => router.push(`/chat?agent=${encodeURIComponent(agent.name)}`)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">{agent.name}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {agent.description}
                    </span>
                  </DropdownMenuItem>
                ))}
              {agents.some((a) => !a.builtin) ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Workspace Agents</DropdownMenuLabel>
                  {agents
                    .filter((a) => !a.builtin)
                    .map((agent) => (
                      <DropdownMenuItem
                        key={agent.name}
                        onSelect={() => router.push(`/chat?agent=${encodeURIComponent(agent.name)}`)}
                        className="flex flex-col items-start gap-0.5"
                      >
                        <span className="font-medium">{agent.name}</span>
                        {agent.description ? (
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {agent.description}
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
          {historyReady && recentConversations.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={sending}
                  aria-label="Recent chats"
                >
                  <History className="h-4 w-4" />
                  Recent
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Last 5 chats (this browser)</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {recentConversations.map((convo) => (
                  <DropdownMenuItem
                    key={convo.id}
                    onSelect={() => openRecentConversation(convo.id)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="w-full truncate font-medium">
                      {convo.agent ? `${convo.agent}: ` : ""}
                      {convo.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(convo.updatedAt).toLocaleString()}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={startNewChat}
            disabled={sending || (turns.length === 0 && !input.trim())}
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
            New
          </Button>
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
          {agentLocksModel ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={0}>
                  <ModelCombobox
                    value={pickerModel}
                    onChange={() => {
                      // The agent owns this chat's model. The header value stays put.
                    }}
                    models={availableModels}
                    loading={modelsLoading}
                    disabled
                    className="w-52 sm:w-64"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>This agent picks its own model. Edit the agent to change it.</TooltipContent>
            </Tooltip>
          ) : (
            <ModelCombobox
              value={model}
              onChange={setModel}
              models={availableModels}
              loading={modelsLoading}
              disabled={!providerVerified}
              className="w-52 sm:w-64"
            />
          )}
          {agentSummary ? (
            <Badge variant="outline" className="max-w-80 truncate font-normal" title={agentSummary}>
              {agentSummary}
            </Badge>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <Switch
                  id="chat-allow-writes"
                  checked={settingsAutoFileWrites || allowFileWrites}
                  onCheckedChange={setAllowFileWrites}
                  disabled={sending || settingsAutoFileWrites}
                />
                <Label htmlFor="chat-allow-writes" className="text-xs text-muted-foreground">
                  Auto-approve file writes
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {settingsAutoFileWrites
                ? "File writes are allowed in Settings, under AI. Turn that off there to ask again."
                : "Allow file writes for this chat without asking. A new chat asks again. Commands still ask."}
            </TooltipContent>
          </Tooltip>
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
                onFixIssues={(request) => void send(request)}
                fixDisabled={sending || !canChat}
                agentName={selectedAgent?.name}
                previousUser={turns[i - 1]?.role === "user" ? turns[i - 1].content : ""}
                provider={provider}
                model={model}
                workflows={workflows}
                onWorkflowSaved={() => void loadWorkflows()}
                onWorkflowStarted={(runId, task) => markWorkflowStarted(i, runId, task)}
              />
            ))
          )}
          {sending ? (
            <div className="space-y-3">
              {live.artifacts.length > 0 ? <LoadedArtifacts artifacts={live.artifacts} /> : null}
              <ThinkingPanel
                name={selectedAgent?.name}
                steps={live.thinking}
                waitingForApproval={live.approvals.length > 0}
              />
              {live.approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  rememberLabel="Allow this exact call for this message"
                  onResolved={(_approved, permission) => {
                    if (permission === "session") setAllowFileWrites(true)
                  }}
                />
              ))}
              {live.content ? (
                <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
                  <MarkdownPreview
                    content={stripWorkflowBlock(stripBundleBlock(stripDraftBlock(live.content)))}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t p-4">
        {files.length > 0 ? (
          <ul
            className="mx-auto mb-2 flex w-full max-w-6xl flex-wrap gap-2"
            aria-label="Attached files"
          >
            {files.map((file, index) => (
              <li key={`${file.kind === "youtube" ? file.videoId : file.name}-${index}`}>
                <AttachmentChip
                  meta={attachmentMeta(file)}
                  onRemove={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  disabled={sending}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="relative mx-auto flex w-full max-w-6xl items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            data-testid="chat-file-input"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = ""
              void addFiles(picked)
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canChat || sending || readingFiles || files.length >= MAX_ATTACHMENTS}
                aria-label="Attach files"
              >
                {readingFiles ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attach text, image, or PDF files</TooltipContent>
          </Tooltip>
          <YouTubeLinkButton
            disabled={!canChat || sending || readingFiles || files.length >= MAX_ATTACHMENTS}
            onAdd={addYouTubeAttachment}
          />
          <FilePickerDialog
            disabled={!canChat || sending || !workspace}
            onPick={insertFileToken}
            onFilesUpdated={setWorkspaceFiles}
            trigger={
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={!canChat || sending || !workspace}
                aria-label="Workspace files"
                title="Insert a workspace file (@file:name) for browser uploads or tasks"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            }
          />
          {mentionOpen ? (
            <MentionMenu
              items={mentionItems}
              activeIndex={mentionIndex}
              emptyLabel={
                loadingArtifacts
                  ? "Loading artifacts…"
                  : workspace
                    ? "No matching artifacts or workflows"
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
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files)
              if (pasted.length === 0) return
              e.preventDefault()
              void addFiles(pasted)
            }}
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
                    : "Describe an agent, command, rule, skill, or workflow… Type /workflow-name to run one"
                  : "Verify a provider to start chatting"
            }
            className="max-h-52 min-h-28 resize-none"
            disabled={!canChat || sending || voice.state === "transcribing"}
            aria-label={
              selectedAgent
                ? `Message ${selectedAgent.name}`
                : "Message assistant"
            }
          />
          {voice.state === "listening" ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={toggleVoice}
              aria-label="Stop voice input"
              className="animate-pulse"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : voice.state === "transcribing" ? (
            <Button type="button" size="icon" disabled aria-label="Transcribing voice">
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          ) : voice.isSupported && !sending && !input.trim() && files.length === 0 ? (
            <Button
              type="button"
              size="icon"
              onClick={toggleVoice}
              disabled={!canChat}
              aria-label="Start voice input"
            >
              <Mic className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => send(input)}
              disabled={!canChat || sending || readingFiles || (!input.trim() && files.length === 0)}
              aria-label="Send"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          )}
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
  onFixIssues,
  fixDisabled,
  agentName,
  previousUser,
  provider,
  model,
  workflows,
  onWorkflowSaved,
  onWorkflowStarted,
}: {
  turn: Turn
  onOpen: (draft: NormalizedDraft) => void
  onFixIssues: (request: string) => void
  fixDisabled: boolean
  agentName?: string
  previousUser: string
  provider: string
  model: string
  workflows: WorkflowListItem[]
  onWorkflowSaved: () => void
  onWorkflowStarted: (runId: string, task: string) => void
}) {
  const isUser = turn.role === "user"
  const bundle = isUser ? null : extractBundle(turn.content)
  const workflowDraft = isUser || bundle ? null : extractWorkflowDraft(turn.content)
  const draft = isUser || bundle || workflowDraft ? null : extractDraft(turn.content)
  const prose = isUser
    ? turn.content
    : stripWorkflowBlock(stripBundleBlock(stripDraftBlock(turn.content)))
  const attached = turnAttachments(turn)
  const runTarget = turn.workflowRun
    ? workflows.find((item) => item.workflow.name === turn.workflowRun?.workflow)?.workflow
    : undefined

  const message = (
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
          <>
            {attached.length > 0 ? (
              <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Files sent">
                {attached.map((meta, index) => (
                  <li key={`${meta.name}-${index}`}>
                    <AttachmentChip meta={meta} unavailable={!turn.files} />
                  </li>
                ))}
              </ul>
            ) : null}
            {turn.content ? (
              <div className="inline-block whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-left text-sm text-primary-foreground">
                {turn.content}
              </div>
            ) : null}
          </>
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
        {workflowDraft ? (
          <WorkflowDraftCard
            workflow={workflowDraft}
            exists={workflows.some((item) => item.workflow.name === workflowDraft.name)}
            onSaved={onWorkflowSaved}
          />
        ) : null}
        {bundle ? (
          <BundleCard
            bundle={bundle}
            onFixIssues={onFixIssues}
            fixDisabled={fixDisabled}
          />
        ) : null}
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

  if (!turn.workflowRun) return message
  return (
    <div className="space-y-3">
      {message}
      <div className="flex gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="h-4 w-4" />
        </div>
        <div className="w-full min-w-0 max-w-xl">
          <WorkflowRunCard
            run={turn.workflowRun}
            workflow={runTarget}
            description={runTarget?.description}
            available={Boolean(runTarget) || Boolean(turn.workflowRun.runId)}
            onStarted={onWorkflowStarted}
          />
        </div>
      </div>
    </div>
  )
}

function AttachmentChip({
  meta,
  onRemove,
  disabled,
  unavailable,
}: {
  meta: AttachmentMeta
  onRemove?: () => void
  disabled?: boolean
  /** Restored from history: the file itself is no longer kept. */
  unavailable?: boolean
}) {
  const Icon = meta.kind === "image" ? FileImage : meta.kind === "youtube" ? Youtube : FileText
  return (
    <span
      className={cn(
        "inline-flex max-w-64 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs",
        unavailable && "opacity-60"
      )}
      title={
        unavailable
          ? `${meta.name} (not kept after reload)`
          : meta.url ?? meta.name
      }
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{meta.name}</span>
      <span className="shrink-0 text-muted-foreground">
        {meta.kind === "youtube" ? "video" : formatBytes(meta.size)}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label={`Remove ${meta.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  )
}
