import { z } from "zod"

import { attachmentMeta, attachmentMetaSchema, type Attachment } from "@/lib/chat/attachments"

/**
 * Browser-local chat history (no DB). Each workspace keeps its own 5 most
 * recent finished conversations in localStorage, so a refresh restores that
 * workspace's chats and another workspace does not see them.
 *
 * Older builds stored every workspace in {@link CONVERSATIONS_STORAGE_KEY}.
 * The first workspace opened after this change takes that list, then the
 * shared key is removed.
 *
 * Electron note: each launch uses a new loopback port/origin, so localStorage
 * does not survive restarts there — same limitation as other browser-only
 * prefs. In a normal browser origin it persists across reloads.
 */

export const MAX_RECENT_CONVERSATIONS = 5
export const CONVERSATIONS_STORAGE_KEY = "black-agents:conversations:v1"

/** localStorage key for one workspace. Paths are encoded so slashes stay in the key. */
export function conversationsStorageKey(workspacePath: string): string {
  return `${CONVERSATIONS_STORAGE_KEY}:${encodeURIComponent(workspacePath.trim())}`
}

export interface ConversationStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}
export const TITLE_MAX_LENGTH = 60

const turnArtifactSchema = z.object({
  type: z.enum(["agent", "command", "rule", "skill"]),
  name: z.string(),
  source: z.enum(["mention", "auto", "linked"]),
})

const toolExecutionTraceSchema = z.object({
  id: z.string(),
  server: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
})

/** A workflow started from chat. Shown as a card, never sent to the model. */
export const workflowRunTurnSchema = z.object({
  workflow: z.string(),
  task: z.string(),
  runId: z.string().optional(),
})
export type WorkflowRunTurn = z.infer<typeof workflowRunTurnSchema>

export const storedTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolExecutions: z.array(toolExecutionTraceSchema).optional(),
  artifacts: z.array(turnArtifactSchema).optional(),
  stoppedAtLimit: z.boolean().optional(),
  /** The user pressed Stop; `content` is the part that arrived. */
  stopped: z.boolean().optional(),
  attachments: z.array(attachmentMetaSchema).optional(),
  workflowRun: workflowRunTurnSchema.optional(),
})
export type StoredTurn = z.infer<typeof storedTurnSchema>

/** A turn in memory may also carry the attached files themselves. */
export type ChatTurn = StoredTurn & { files?: Attachment[] }

/** Drop file contents before a turn goes to localStorage. */
export function toStoredTurn(turn: ChatTurn): StoredTurn {
  const { files, ...rest } = turn
  if (!files || files.length === 0) return rest
  return { ...rest, attachments: files.map(attachmentMeta) }
}

export const storedConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  updatedAt: z.string().datetime(),
  agent: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  messages: z.array(storedTurnSchema),
})
export type StoredConversation = z.infer<typeof storedConversationSchema>

export const conversationsStoreSchema = z.object({
  conversations: z.array(storedConversationSchema),
  activeId: z.string().nullable(),
})
export type ConversationsStore = z.infer<typeof conversationsStoreSchema>

export const EMPTY_CONVERSATIONS_STORE: ConversationsStore = {
  conversations: [],
  activeId: null,
}

export interface ConversationUpsertInput {
  id: string
  messages: ChatTurn[]
  agent?: string
  provider?: string
  model?: string
  updatedAt?: string
}

/** First user message, trimmed/truncated — used as the history label. */
export function titleFromMessages(messages: StoredTurn[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim())
  if (!firstUser) return "New chat"
  const flat = firstUser.content.trim().replace(/\s+/g, " ")
  if (flat.length <= TITLE_MAX_LENGTH) return flat
  return `${flat.slice(0, TITLE_MAX_LENGTH - 1)}…`
}

export function createConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Insert or replace a conversation, newest first, capped at
 * {@link MAX_RECENT_CONVERSATIONS}. Empty message lists are not stored.
 */
export function upsertConversation(
  store: ConversationsStore,
  input: ConversationUpsertInput
): ConversationsStore {
  if (input.messages.length === 0) {
    return { ...store, activeId: input.id }
  }
  const conversation: StoredConversation = {
    id: input.id,
    title: titleFromMessages(input.messages),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    agent: input.agent,
    provider: input.provider,
    model: input.model,
    messages: input.messages.map(toStoredTurn),
  }
  const rest = store.conversations.filter((c) => c.id !== input.id)
  return {
    activeId: input.id,
    conversations: [conversation, ...rest].slice(0, MAX_RECENT_CONVERSATIONS),
  }
}

export function removeConversation(
  store: ConversationsStore,
  id: string
): ConversationsStore {
  const conversations = store.conversations.filter((c) => c.id !== id)
  return {
    conversations,
    activeId: store.activeId === id ? (conversations[0]?.id ?? null) : store.activeId,
  }
}

export function setActiveConversation(
  store: ConversationsStore,
  id: string | null
): ConversationsStore {
  if (id === null) return { ...store, activeId: null }
  if (!store.conversations.some((c) => c.id === id)) return store
  return { ...store, activeId: id }
}

export function getConversation(
  store: ConversationsStore,
  id: string
): StoredConversation | undefined {
  return store.conversations.find((c) => c.id === id)
}

export function parseConversationsStore(raw: unknown): ConversationsStore {
  const parsed = conversationsStoreSchema.safeParse(raw)
  if (!parsed.success) return EMPTY_CONVERSATIONS_STORE
  return {
    activeId: parsed.data.activeId,
    conversations: parsed.data.conversations.slice(0, MAX_RECENT_CONVERSATIONS),
  }
}

export function readConversationsStore(
  workspacePath: string,
  storage: ConversationStorage = browserStorage
): ConversationsStore {
  const path = workspacePath.trim()
  if (!path) return EMPTY_CONVERSATIONS_STORE
  const key = conversationsStorageKey(path)
  try {
    const own = storage.getItem(key)
    if (own) return parseConversationsStore(JSON.parse(own) as unknown)
  } catch {
    return EMPTY_CONVERSATIONS_STORE
  }
  return adoptLegacyStore(path, key, storage)
}

export function writeConversationsStore(
  workspacePath: string,
  store: ConversationsStore,
  storage: ConversationStorage = browserStorage
): void {
  const path = workspacePath.trim()
  if (!path) return
  try {
    storage.setItem(conversationsStorageKey(path), JSON.stringify(store))
  } catch {
    // private mode / quota — non-fatal
  }
}

/** Move the old shared list into this workspace once, then delete it. */
function adoptLegacyStore(
  workspacePath: string,
  key: string,
  storage: ConversationStorage
): ConversationsStore {
  let legacyRaw: string | null
  try {
    legacyRaw = storage.getItem(CONVERSATIONS_STORAGE_KEY)
  } catch {
    return EMPTY_CONVERSATIONS_STORE
  }
  if (!legacyRaw) return EMPTY_CONVERSATIONS_STORE
  try {
    const legacy = parseConversationsStore(JSON.parse(legacyRaw) as unknown)
    writeConversationsStore(workspacePath, legacy, storage)
    if (storage.getItem(key)) storage.removeItem(CONVERSATIONS_STORAGE_KEY)
    return legacy
  } catch {
    try {
      storage.removeItem(CONVERSATIONS_STORAGE_KEY)
    } catch {
      // ignore
    }
    return EMPTY_CONVERSATIONS_STORE
  }
}

function defaultGetItem(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function defaultSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function defaultRemoveItem(key: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

const browserStorage: ConversationStorage = {
  getItem: defaultGetItem,
  setItem: defaultSetItem,
  removeItem: defaultRemoveItem,
}
