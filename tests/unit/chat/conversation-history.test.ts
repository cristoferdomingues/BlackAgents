import { describe, expect, it } from "vitest"

import {
  CONVERSATIONS_STORAGE_KEY,
  conversationsStorageKey,
  createConversationId,
  EMPTY_CONVERSATIONS_STORE,
  getConversation,
  MAX_RECENT_CONVERSATIONS,
  parseConversationsStore,
  readConversationsStore,
  removeConversation,
  setActiveConversation,
  titleFromMessages,
  toStoredTurn,
  upsertConversation,
  writeConversationsStore,
  type ConversationStorage,
  type ConversationsStore,
  type StoredTurn,
} from "@/lib/chat/conversation-history"

const turns = (texts: string[]): StoredTurn[] =>
  texts.flatMap((text, i) => [
    { role: "user" as const, content: text },
    { role: "assistant" as const, content: `reply-${i}` },
  ])

describe("titleFromMessages", () => {
  it("uses the first user message and truncates long titles", () => {
    expect(titleFromMessages([])).toBe("New chat")
    expect(titleFromMessages([{ role: "assistant", content: "hi" }])).toBe("New chat")
    expect(titleFromMessages([{ role: "user", content: "  hello   world  " }])).toBe("hello world")
    const long = "x".repeat(80)
    expect(titleFromMessages([{ role: "user", content: long }])).toBe(`${"x".repeat(59)}…`)
  })
})

describe("upsertConversation", () => {
  it("inserts newest first, updates in place, and caps at five", () => {
    let store: ConversationsStore = EMPTY_CONVERSATIONS_STORE
    for (let i = 0; i < MAX_RECENT_CONVERSATIONS + 2; i++) {
      store = upsertConversation(store, {
        id: `c${i}`,
        messages: turns([`msg-${i}`]),
        updatedAt: new Date(2026, 0, i + 1).toISOString(),
      })
    }
    expect(store.conversations).toHaveLength(MAX_RECENT_CONVERSATIONS)
    expect(store.conversations.map((c) => c.id)).toEqual(["c6", "c5", "c4", "c3", "c2"])
    expect(store.activeId).toBe("c6")

    store = upsertConversation(store, {
      id: "c4",
      messages: turns(["updated"]),
      updatedAt: new Date(2026, 0, 20).toISOString(),
    })
    expect(store.conversations[0]).toMatchObject({ id: "c4", title: "updated" })
    expect(store.conversations).toHaveLength(MAX_RECENT_CONVERSATIONS)
  })

  it("keeps only file metadata and workflow-run turns in storage", () => {
    const store = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "files",
      messages: [
        {
          role: "user",
          content: "read this",
          files: [{ kind: "pdf", name: "doc.pdf", data: "JVBERi0=" }],
        },
        { role: "user", content: "/triage x", workflowRun: { workflow: "triage", task: "x" } },
      ],
    })
    const [first, second] = store.conversations[0].messages
    expect(first).toEqual({
      role: "user",
      content: "read this",
      attachments: [{ kind: "pdf", name: "doc.pdf", size: 5 }],
    })
    expect(JSON.stringify(first)).not.toContain("JVBERi0")
    expect(second.workflowRun).toEqual({ workflow: "triage", task: "x" })
    expect(parseConversationsStore(store).conversations[0].messages).toEqual([first, second])
  })

  it("leaves turns without files unchanged", () => {
    expect(toStoredTurn({ role: "assistant", content: "hi" })).toEqual({ role: "assistant", content: "hi" })
  })

  it("does not persist empty threads but still tracks activeId", () => {
    const store = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "empty",
      messages: [],
    })
    expect(store.conversations).toHaveLength(0)
    expect(store.activeId).toBe("empty")
  })
})

describe("remove / setActive / get", () => {
  it("removes a conversation and clears active when needed", () => {
    let store = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "a",
      messages: turns(["a"]),
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    store = upsertConversation(store, {
      id: "b",
      messages: turns(["b"]),
      updatedAt: "2026-01-02T00:00:00.000Z",
    })
    expect(getConversation(store, "a")?.title).toBe("a")
    store = removeConversation(store, "b")
    expect(store.activeId).toBe("a")
    expect(store.conversations.map((c) => c.id)).toEqual(["a"])
    store = setActiveConversation(store, "missing")
    expect(store.activeId).toBe("a")
    store = setActiveConversation(store, null)
    expect(store.activeId).toBeNull()
  })
})

function memoryStorage(memory: Map<string, string>): ConversationStorage {
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value)
    },
    removeItem: (key) => {
      memory.delete(key)
    },
  }
}

describe("parse / read / write", () => {
  it("rejects malformed payloads and round-trips through a memory map", () => {
    expect(parseConversationsStore(null)).toEqual(EMPTY_CONVERSATIONS_STORE)
    expect(parseConversationsStore({ conversations: "nope" })).toEqual(EMPTY_CONVERSATIONS_STORE)
    expect(createConversationId().length).toBeGreaterThan(8)

    const memory = new Map<string, string>()
    const storage = memoryStorage(memory)
    const store = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "x",
      messages: turns(["hello"]),
      agent: "reviewer",
      provider: "openai",
      model: "gpt-4o",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    writeConversationsStore("/work/alpha", store, storage)
    expect(memory.get(conversationsStorageKey("/work/alpha"))).toContain("hello")
    expect(readConversationsStore("/work/alpha", storage)).toEqual(store)
    expect(readConversationsStore("  ", storage)).toEqual(EMPTY_CONVERSATIONS_STORE)
  })

  it("keeps each workspace's chats separate", () => {
    const memory = new Map<string, string>()
    const storage = memoryStorage(memory)
    const alpha = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "a",
      messages: turns(["alpha chat"]),
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    const beta = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "b",
      messages: turns(["beta chat"]),
      updatedAt: "2026-01-02T00:00:00.000Z",
    })
    writeConversationsStore("/work/alpha", alpha, storage)
    writeConversationsStore("/work/beta", beta, storage)

    expect(readConversationsStore("/work/alpha", storage).conversations.map((c) => c.id)).toEqual(["a"])
    expect(readConversationsStore("/work/beta", storage).conversations.map((c) => c.id)).toEqual(["b"])
    expect(conversationsStorageKey("/work/alpha")).not.toBe(conversationsStorageKey("/work/beta"))
    expect(memory.has(CONVERSATIONS_STORAGE_KEY)).toBe(false)
  })

  it("moves the old shared list into the first workspace that opens it", () => {
    const memory = new Map<string, string>()
    const storage = memoryStorage(memory)
    const legacy = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "old",
      messages: turns(["from before"]),
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    memory.set(CONVERSATIONS_STORAGE_KEY, JSON.stringify(legacy))

    expect(readConversationsStore("/work/alpha", storage)).toEqual(legacy)
    expect(memory.has(CONVERSATIONS_STORAGE_KEY)).toBe(false)
    expect(readConversationsStore("/work/beta", storage)).toEqual(EMPTY_CONVERSATIONS_STORE)
    expect(readConversationsStore("/work/alpha", storage).conversations[0]?.title).toBe("from before")
  })

  it("does not give a blank path the old shared list", () => {
    const memory = new Map<string, string>()
    const storage = memoryStorage(memory)
    memory.set(CONVERSATIONS_STORAGE_KEY, JSON.stringify({ conversations: [], activeId: null }))
    expect(readConversationsStore("", storage)).toEqual(EMPTY_CONVERSATIONS_STORE)
    expect(memory.has(CONVERSATIONS_STORAGE_KEY)).toBe(true)
  })

  it("drops a broken shared list instead of copying it", () => {
    const memory = new Map<string, string>()
    const storage = memoryStorage(memory)
    memory.set(CONVERSATIONS_STORAGE_KEY, "{")
    expect(readConversationsStore("/work/alpha", storage)).toEqual(EMPTY_CONVERSATIONS_STORE)
    expect(memory.has(CONVERSATIONS_STORAGE_KEY)).toBe(false)
  })

  it("returns an empty store when a workspace payload is broken", () => {
    const memory = new Map<string, string>()
    const storage = memoryStorage(memory)
    memory.set(conversationsStorageKey("/work/alpha"), "{")
    expect(readConversationsStore("/work/alpha", storage)).toEqual(EMPTY_CONVERSATIONS_STORE)
  })
})

describe("conversation memory in history", () => {
  const memory = { summary: "Earlier.", facts: ["Agent: study-coach"], covered: 2 }

  it("stores the memory with the conversation and reads it back", () => {
    const store = upsertConversation(EMPTY_CONVERSATIONS_STORE, { id: "c1", messages: turns(["a", "b"]), memory })
    expect(getConversation(store, "c1")?.memory).toEqual(memory)
    const restored = parseConversationsStore(JSON.parse(JSON.stringify(store)) as unknown)
    expect(getConversation(restored, "c1")?.memory).toEqual(memory)
  })

  it("leaves memory out when there is none", () => {
    const store = upsertConversation(EMPTY_CONVERSATIONS_STORE, { id: "c1", messages: turns(["a"]), memory: null })
    expect(getConversation(store, "c1")).not.toHaveProperty("memory")
  })

  it("drops a broken memory but keeps the messages", () => {
    const store = upsertConversation(EMPTY_CONVERSATIONS_STORE, { id: "c1", messages: turns(["a"]) })
    const raw = JSON.parse(JSON.stringify(store)) as { conversations: Array<Record<string, unknown>> }
    raw.conversations[0].memory = { summary: 1, facts: "x", covered: -3 }
    const restored = parseConversationsStore(raw)
    expect(getConversation(restored, "c1")?.memory).toBeUndefined()
    expect(getConversation(restored, "c1")?.messages).toHaveLength(2)
  })
})
