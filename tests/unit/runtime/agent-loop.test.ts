import { describe, expect, it, vi } from "vitest"

import { ProviderError } from "@/lib/llm/types"
import {
  AgentContextLimitError,
  compactToolHistory,
  LoopAbortedError,
  runAgentLoop,
  truncateResult,
  type AgentLoopOptions,
} from "@/lib/runtime/agent-loop"
import { createApprovalPolicy } from "@/lib/runtime/approval-policy"
import type { AgentLoopEvent } from "@/lib/runtime/types"

import { call, fakeTool, scriptedProvider } from "../../helpers/runtime"

function options(overrides: Partial<AgentLoopOptions>): AgentLoopOptions {
  return {
    provider: scriptedProvider([{ content: "done" }]),
    credentials: { apiKey: "k" },
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    workspaceRoot: "/tmp",
    policy: createApprovalPolicy(),
    approve: async () => ({ approved: true }),
    ...overrides,
  }
}

describe("runAgentLoop", () => {
  it("returns the reply when the model calls no tools", async () => {
    const result = await runAgentLoop(options({}))
    expect(result).toMatchObject({ content: "done", turns: 1, stoppedAtLimit: false })
  })

  it("runs read tools without approval and feeds results back", async () => {
    const tool = fakeTool("lookup", "read")
    const provider = scriptedProvider([
      { toolCalls: [call("c1", "lookup", { q: 1 })] },
      { content: "answer" },
    ])
    const approve = vi.fn()
    const events: AgentLoopEvent[] = []
    const result = await runAgentLoop(
      options({ provider, tools: [tool], approve, onEvent: (e) => events.push(e) })
    )
    expect(result.content).toBe("answer")
    expect(tool.calls).toEqual([{ q: 1 }])
    expect(approve).not.toHaveBeenCalled()
    expect(result.toolExecutions[0]).toMatchObject({ tool: "lookup", result: { echo: { q: 1 } } })
    const second = provider.requests[1]
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" })
    expect(events.map((e) => e.type)).toEqual([
      "turn_start",
      "llm_request",
      "llm_response",
      "tool_call",
      "tool_result",
      "turn_start",
      "llm_request",
      "llm_response",
      "token",
    ])
  })

  it("emits turn and llm events around each model call", async () => {
    const provider = scriptedProvider([{ content: "answer", reasoning: "plan" }])
    const events: AgentLoopEvent[] = []
    const exchanges: Array<{ turn: number; content: string }> = []
    await runAgentLoop(
      options({
        provider,
        onEvent: (e) => events.push(e),
        onLlmExchange: (ex) => exchanges.push({ turn: ex.turn, content: ex.content }),
      })
    )
    expect(events.map((e) => e.type)).toEqual([
      "turn_start",
      "llm_request",
      "llm_response",
      "thinking",
      "token",
    ])
    expect(events[0]).toMatchObject({ type: "turn_start", turn: 0, maxTurns: 25 })
    expect(events[2]).toMatchObject({ type: "llm_response", turn: 0, toolCallCount: 0 })
    expect(exchanges).toEqual([{ turn: 0, content: "answer" }])
  })

  it("emits the model's reasoning before its reply", async () => {
    const provider = scriptedProvider([{ content: "answer", reasoning: "plan" }])
    const events: AgentLoopEvent[] = []
    await runAgentLoop(options({ provider, onEvent: (e) => events.push(e) }))
    expect(events.filter((e) => e.type === "thinking" || e.type === "token")).toEqual([
      { type: "thinking", turn: 0, content: "plan" },
      { type: "token", turn: 0, content: "answer" },
    ])
  })

  it("asks before write and exec calls, and reports denials to the model", async () => {
    const write = fakeTool("write", "write")
    const exec = fakeTool("exec", "exec")
    const provider = scriptedProvider([
      { toolCalls: [call("a", "write"), call("b", "exec")] },
      { content: "ok" },
    ])
    const approve = vi
      .fn()
      .mockResolvedValueOnce({ approved: true })
      .mockResolvedValueOnce({ approved: false })
    const result = await runAgentLoop(options({ provider, tools: [write, exec], approve }))
    expect(approve).toHaveBeenCalledTimes(2)
    expect(write.calls).toHaveLength(1)
    expect(exec.calls).toHaveLength(0)
    expect(result.toolExecutions[1].error).toBe("The user denied this tool call")
  })

  it("auto-approves writes when allowed but still asks for exec", async () => {
    const write = fakeTool("write", "write")
    const exec = fakeTool("exec", "exec")
    const provider = scriptedProvider([
      { toolCalls: [call("a", "write"), call("b", "exec")] },
      { content: "ok" },
    ])
    const approve = vi.fn().mockResolvedValue({ approved: true })
    await runAgentLoop(
      options({ provider, tools: [write, exec], approve, policy: createApprovalPolicy(true) })
    )
    expect(approve).toHaveBeenCalledTimes(1)
  })

  it("allows later file writes in the same reply after one approval", async () => {
    const write = fakeTool("fs_write", "write")
    const other = fakeTool("mcp_write", "write")
    const provider = scriptedProvider([
      {
        toolCalls: [
          call("a", "fs_write", { path: "a.md" }),
          call("b", "fs_write", { path: "b.md" }),
          call("c", "mcp_write"),
        ],
      },
      { content: "ok" },
    ])
    const approve = vi.fn().mockResolvedValue({ approved: true, fileWritePermission: "message" as const })
    await runAgentLoop(options({ provider, tools: [write, other], approve }))
    expect(approve).toHaveBeenCalledTimes(2)
    expect(write.calls).toHaveLength(2)
    expect(other.calls).toHaveLength(1)
  })

  it("remembers an exact exec call for the rest of the run", async () => {
    const exec = fakeTool("exec", "exec")
    const provider = scriptedProvider([
      { toolCalls: [call("a", "exec", { x: 1 })] },
      { toolCalls: [call("b", "exec", { x: 1 }), call("c", "exec", { x: 2 })] },
      { content: "ok" },
    ])
    const approve = vi.fn().mockResolvedValue({ approved: true, remember: true })
    await runAgentLoop(options({ provider, tools: [exec], approve }))
    // first {x:1} asks, second {x:1} is remembered, {x:2} asks again
    expect(approve).toHaveBeenCalledTimes(2)
    expect(exec.calls).toHaveLength(3)
  })

  it("reports unknown tools and tool errors without crashing", async () => {
    const broken = fakeTool("broken", "read", () => {
      throw new Error("boom")
    })
    const provider = scriptedProvider([
      { toolCalls: [call("a", "ghost"), call("b", "broken")] },
      { content: "ok" },
    ])
    const result = await runAgentLoop(options({ provider, tools: [broken] }))
    expect(result.toolExecutions.map((t) => t.error)).toEqual(['Unknown tool "ghost"', "boom"])
  })

  it("asks for a final answer when the turn limit is reached", async () => {
    const tool = fakeTool("loop", "read")
    const provider = scriptedProvider([
      { toolCalls: [call("a", "loop")] },
      { toolCalls: [call("b", "loop")] },
      { content: "final" },
    ])
    const result = await runAgentLoop(options({ provider, tools: [tool], maxTurns: 2 }))
    expect(result).toMatchObject({ content: "final", stoppedAtLimit: true, turns: 2 })
    expect(provider.requests).toHaveLength(3)
    expect(provider.requests[2].tools).toBeDefined()
  })

  it("caps tool calls from one runaway model reply", async () => {
    const tool = fakeTool("search", "read")
    const calls = Array.from({ length: 30 }, (_, i) => call(`c${i}`, "search", { q: i }))
    const provider = scriptedProvider([{ toolCalls: calls }, { content: "partial result" }])
    const events: AgentLoopEvent[] = []
    const result = await runAgentLoop(
      options({
        provider,
        tools: [tool],
        maxToolCallsPerTurn: 3,
        onEvent: (event) => events.push(event),
      })
    )
    expect(tool.calls).toHaveLength(3)
    expect(result).toMatchObject({ content: "partial result", stoppedAtLimit: true, turns: 1 })
    expect(events.find((event) => event.type === "tool_limit")).toMatchObject({
      type: "tool_limit",
      requested: 30,
      accepted: 3,
      duplicates: 0,
      reason: "per_turn",
    })
  })

  it("removes duplicate calls in the same model reply", async () => {
    const tool = fakeTool("search", "read")
    const calls = Array.from({ length: 30 }, (_, i) => call(`c${i}`, "search", { q: "same" }))
    const provider = scriptedProvider([{ toolCalls: calls }, { content: "done" }])
    const events: AgentLoopEvent[] = []
    await runAgentLoop(
      options({ provider, tools: [tool], onEvent: (event) => events.push(event) })
    )
    expect(tool.calls).toHaveLength(1)
    expect(events.find((event) => event.type === "tool_limit")).toMatchObject({
      accepted: 1,
      duplicates: 29,
    })
  })

  it("caps total calls across turns", async () => {
    const tool = fakeTool("search", "read")
    const provider = scriptedProvider([
      { toolCalls: Array.from({ length: 3 }, (_, i) => call(`a${i}`, "search", { q: `a${i}` })) },
      { toolCalls: Array.from({ length: 3 }, (_, i) => call(`b${i}`, "search", { q: `b${i}` })) },
      { content: "stopped safely" },
    ])
    const events: AgentLoopEvent[] = []
    const result = await runAgentLoop(
      options({
        provider,
        tools: [tool],
        maxToolCallsPerTurn: 3,
        maxTotalToolCalls: 5,
        onEvent: (event) => events.push(event),
      })
    )
    expect(tool.calls).toHaveLength(5)
    expect(result.content).toBe("stopped safely")
    expect(events.find((event) => event.type === "tool_limit")).toMatchObject({
      reason: "total",
      requested: 3,
      accepted: 2,
    })
  })

  it("propagates provider errors", async () => {
    const provider = scriptedProvider([new ProviderError("bad key", 401)])
    await expect(runAgentLoop(options({ provider }))).rejects.toBeInstanceOf(ProviderError)
  })

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runAgentLoop(options({ signal: controller.signal }))).rejects.toBeInstanceOf(
      LoopAbortedError
    )
  })

  it("times out slow tools", async () => {
    const slow = fakeTool("slow", "read")
    slow.execute = () => new Promise(() => {})
    const provider = scriptedProvider([{ toolCalls: [call("a", "slow")] }, { content: "ok" }])
    const result = await runAgentLoop(options({ provider, tools: [slow], toolTimeoutMs: 20 }))
    expect(result.toolExecutions[0].error).toMatch(/timed out/)
  })
})

describe("compactToolHistory", () => {
  it("removes old complete tool exchanges but keeps initial messages", () => {
    const messages = [
      { role: "user" as const, content: "task" },
      { role: "assistant" as const, content: "", tool_calls: [call("a", "read")] },
      { role: "tool" as const, content: "x".repeat(100), tool_call_id: "a", name: "read" },
      { role: "assistant" as const, content: "", tool_calls: [call("b", "read")] },
      { role: "tool" as const, content: "ok", tool_call_id: "b", name: "read" },
    ]
    const compacted = compactToolHistory(messages, 1, undefined, [], 250)
    expect(compacted.messages[0]).toMatchObject({ role: "user", content: "task" })
    expect(compacted.removedMessages).toBe(2)
    expect(compacted.messages.some((m) => m.tool_call_id === "b")).toBe(true)
  })

  it("fails clearly when the protected prompt alone is too large", () => {
    expect(() =>
      compactToolHistory(
        [{ role: "user", content: "x".repeat(100) }],
        1,
        "system",
        [],
        20
      )
    ).toThrow(AgentContextLimitError)
  })
})

describe("truncateResult", () => {
  it("keeps short values and cuts long ones", () => {
    expect(truncateResult({ a: 1 })).toBe('{"a":1}')
    const long = truncateResult("x".repeat(50), 10)
    expect(long.startsWith("xxxxxxxxxx\n…[truncated 40 chars]")).toBe(true)
  })
})
