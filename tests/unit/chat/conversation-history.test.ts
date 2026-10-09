import { describe, expect, it } from "vitest"

import {
  CONVERSATIONS_STORAGE_KEY,
  createConversationId,
  EMPTY_CONVERSATIONS_STORE,
  getConversation,
  MAX_RECENT_CONVERSATIONS,
  parseConversationsStore,
  readConversationsStore,
  removeConversation,
  setActiveConversation,
  titleFromMessages,
  upsertConversation,
  writeConversationsStore,
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

describe("parse / read / write", () => {
  it("rejects malformed payloads and round-trips through a memory map", () => {
    expect(parseConversationsStore(null)).toEqual(EMPTY_CONVERSATIONS_STORE)
    expect(parseConversationsStore({ conversations: "nope" })).toEqual(EMPTY_CONVERSATIONS_STORE)
    expect(createConversationId().length).toBeGreaterThan(8)

    const memory = new Map<string, string>()
    const store = upsertConversation(EMPTY_CONVERSATIONS_STORE, {
      id: "x",
      messages: turns(["hello"]),
      agent: "reviewer",
      provider: "openai",
      model: "gpt-4o",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    writeConversationsStore(store, (key, value) => memory.set(key, value))
    expect(memory.get(CONVERSATIONS_STORAGE_KEY)).toContain("hello")
    expect(
      readConversationsStore((key) => memory.get(key) ?? null)
    ).toEqual(store)
  })
})
