import { afterEach, describe, expect, it, vi } from "vitest"

import {
  callKey,
  createApprovalPolicy,
  needsApproval,
  preapprovedCallKey,
  rememberCall,
} from "@/lib/runtime/approval-policy"
import {
  getPendingApproval,
  listPendingApprovals,
  requestApproval,
  resolveApproval,
} from "@/lib/runtime/approvals"
import {
  createRegistryApprover,
  createRegistryBatchApprover,
  denyAllApprover,
  trustHintForTool,
} from "@/lib/runtime/ask-user"
import { shellRunTool } from "@/lib/runtime/tools/shell"
import type { ApprovalRequest } from "@/lib/runtime/types"

import { fakeTool } from "../../helpers/runtime"

const base = {
  tool: "shell_run",
  server: "builtin",
  risk: "exec" as const,
  summary: "$ ls",
  args: {},
  scope: { kind: "chat" as const },
}

afterEach(() => {
  vi.useRealTimers()
  for (const p of listPendingApprovals()) resolveApproval(p.id, { approved: false })
})

describe("approval policy", () => {
  it("never asks for read, asks for write unless allowed, always asks for exec", () => {
    const policy = createApprovalPolicy()
    expect(needsApproval(fakeTool("r", "read"), {}, policy)).toBe(false)
    expect(needsApproval(fakeTool("w", "write"), {}, policy)).toBe(true)
    expect(needsApproval(fakeTool("w", "write"), {}, createApprovalPolicy(true))).toBe(false)
    expect(needsApproval(fakeTool("x", "exec"), {}, createApprovalPolicy(true))).toBe(true)
  })

  it("auto-approves only builtin file writes when file writes are allowed", () => {
    const policy = createApprovalPolicy(false, true)
    expect(needsApproval(fakeTool("fs_write", "write"), {}, policy)).toBe(false)
    expect(needsApproval(fakeTool("fs_edit", "write"), {}, policy)).toBe(false)
    expect(needsApproval({ ...fakeTool("fs_write", "write"), source: "mcp" as const }, {}, policy)).toBe(true)
    expect(needsApproval(fakeTool("other", "write"), {}, policy)).toBe(true)
    const protectedWrite = { ...fakeTool("fs_write", "write"), riskFor: () => "exec" as const }
    expect(needsApproval(protectedWrite, {}, policy)).toBe(true)
  })

  it("uses per-call risk and remembers exact calls", () => {
    const tool = { ...fakeTool("fs", "write"), riskFor: () => "exec" as const }
    const policy = createApprovalPolicy(true)
    expect(needsApproval(tool, { a: 1 }, policy)).toBe(true)
    rememberCall(policy, tool, { a: 1 })
    expect(needsApproval(tool, { a: 1 }, policy)).toBe(false)
    expect(needsApproval(tool, { a: 2 }, policy)).toBe(true)
  })

  it("skips approval for a saved flow the user marked as already tested", () => {
    const policy = createApprovalPolicy()
    const run = fakeTool("browser_run_flow", "exec")
    const click = {
      ...fakeTool("browser__browser_click", "exec"),
      originalName: "browser_click",
      server: "browser",
    }
    expect(needsApproval(run, { name: "clock-in" }, policy)).toBe(true)
    expect(needsApproval(click, { element: "Clock in" }, policy)).toBe(true)

    policy.autoAcceptFlows.add("clock-in")
    policy.autoAcceptedCalls.add(preapprovedCallKey("browser_click", { element: "Clock in" }))

    expect(needsApproval(run, { name: "clock-in" }, policy)).toBe(false)
    expect(needsApproval(click, { element: "Clock in" }, policy)).toBe(false)
    expect(needsApproval(click, { element: "Somewhere else" }, policy)).toBe(true)
    expect(needsApproval(run, { name: "other-flow" }, policy)).toBe(true)
  })

  it("builds the same key regardless of argument order", () => {
    const tool = fakeTool("t", "exec")
    expect(callKey(tool, { a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      callKey(tool, { b: [1, { d: 3, c: 2 }], a: 1 })
    )
  })

  it("runs read-only shell commands and asks before the rest", () => {
    expect(needsApproval(shellRunTool, { command: "git status" }, createApprovalPolicy())).toBe(false)
    expect(needsApproval(shellRunTool, { command: "npm test" }, createApprovalPolicy())).toBe(false)
    expect(needsApproval(shellRunTool, { command: "npm install" }, createApprovalPolicy())).toBe(true)
  })

  it("skips a trusted write-risk shell command but never an exec one", () => {
    const policy = createApprovalPolicy()
    policy.trustedShellCommands.add("mkdir")
    expect(needsApproval(shellRunTool, { command: "mkdir -p out" }, policy)).toBe(false)
    expect(needsApproval(shellRunTool, { command: "mkdir out > log" }, policy)).toBe(true)
    expect(needsApproval(shellRunTool, { command: "git push" }, policy)).toBe(true)
  })

  it("covers every program in a trusted sequence", () => {
    const policy = createApprovalPolicy()
    policy.trustedShellCommands.add("mkdir")
    expect(needsApproval(shellRunTool, { command: "mkdir out && cp a b" }, policy)).toBe(true)
    policy.trustedShellCommands.add("cp")
    expect(needsApproval(shellRunTool, { command: "mkdir out && cp a b" }, policy)).toBe(false)
  })

  it("offers a shell trust hint only for plain write commands", () => {
    expect(trustHintForTool(shellRunTool, { command: "mkdir -p out" })).toEqual({
      kind: "shell",
      programs: ["mkdir"],
    })
    expect(trustHintForTool(shellRunTool, { command: "mkdir out && cp a b" })).toEqual({
      kind: "shell",
      programs: ["cp", "mkdir"],
    })
    expect(trustHintForTool(shellRunTool, { command: "mkdir out > log" })).toBeUndefined()
    expect(trustHintForTool(shellRunTool, { command: "git push" })).toBeUndefined()
    expect(trustHintForTool(shellRunTool, { command: "git status" })).toBeUndefined()
  })

  it("offers server trust for write-risk MCP calls only", () => {
    const write = {
      ...fakeTool("do_thing", "write"),
      source: "mcp" as const,
      server: "github",
    }
    expect(trustHintForTool(write, {})).toEqual({ kind: "mcp", server: "github" })
    expect(trustHintForTool({ ...write, risk: "exec" as const }, {})).toBeUndefined()
  })
})

describe("approval registry", () => {
  it("lists, resolves, and forgets a pending approval", async () => {
    const handle = requestApproval(base)
    expect(getPendingApproval(handle.request.id)).toMatchObject({ tool: "shell_run" })
    expect(resolveApproval(handle.request.id, { approved: true })).toBe(true)
    await expect(handle.decision).resolves.toEqual({ approved: true })
    expect(getPendingApproval(handle.request.id)).toBeNull()
    expect(resolveApproval(handle.request.id, { approved: true })).toBe(false)
  })

  it("denies on timeout", async () => {
    vi.useFakeTimers()
    const handle = requestApproval(base, { timeoutMs: 1_000 })
    vi.advanceTimersByTime(1_001)
    await expect(handle.decision).resolves.toEqual({ approved: false })
  })

  it("denies on abort, also when already aborted", async () => {
    const controller = new AbortController()
    const handle = requestApproval(base, { signal: controller.signal })
    controller.abort()
    await expect(handle.decision).resolves.toEqual({ approved: false })
    const pre = requestApproval(base, { signal: controller.signal })
    await expect(pre.decision).resolves.toEqual({ approved: false })
  })

  it("registry approver notifies on request and resolution", async () => {
    const seen: string[] = []
    const approve = createRegistryApprover({
      scope: { kind: "chat" },
      onRequest: (request) => {
        seen.push(`request:${request.summary}`)
        resolveApproval(request.id, { approved: true })
      },
      onResolved: (_r, d) => {
        seen.push(`resolved:${d.approved}`)
      },
    })
    const tool = { ...fakeTool("shell", "exec"), summarize: () => "$ npm test" }
    await expect(approve(tool, {})).resolves.toEqual({ approved: true })
    expect(seen).toEqual(["request:$ npm test", "resolved:true"])
  })

  it("deny-all approver explains why", async () => {
    const decision = await denyAllApprover(fakeTool("x", "exec"), {})
    expect(decision.approved).toBe(false)
    expect(decision.reason).toMatch(/streaming chat/)
  })

  it("batches calls into one request and maps per-call decisions", async () => {
    const calls = [
      { id: "c1", tool: fakeTool("fs_write", "write"), args: { path: "a.md" } },
      { id: "c2", tool: fakeTool("shell_run", "exec"), args: { command: "npm test" } },
    ]
    let request: ApprovalRequest | undefined
    const approve = createRegistryBatchApprover({
      scope: { kind: "chat" },
      onRequest: (pending) => {
        request = pending
        resolveApproval(pending.id, {
          approved: true,
          callDecisions: { c1: true, c2: false },
        })
      },
    })

    const decisions = await approve(calls)

    expect(request?.calls).toHaveLength(2)
    expect(request?.risk).toBe("exec")
    expect(request?.summary).toBe("2 tool calls need approval")
    expect(decisions.c1).toEqual({ approved: true })
    expect(decisions.c2).toMatchObject({ approved: false })
  })

  it("keeps a single call on the familiar shape", async () => {
    const tool = fakeTool("fs_write", "write")
    const approve = createRegistryBatchApprover({
      scope: { kind: "chat" },
      onRequest: (request) => {
        expect(request.tool).toBe("fs_write")
        expect(request.calls).toHaveLength(1)
        resolveApproval(request.id, { approved: true, fileWritePermission: "message" })
      },
    })

    await expect(approve([{ id: "c1", tool, args: { path: "a" } }])).resolves.toEqual({
      c1: { approved: true, fileWritePermission: "message" },
    })
  })

  it("adds one trust hint when every call shares it", async () => {
    let request: ApprovalRequest | undefined
    const approve = createRegistryBatchApprover({
      scope: { kind: "chat" },
      onRequest: (pending) => {
        request = pending
        resolveApproval(pending.id, { approved: true })
      },
    })

    await approve([
      { id: "c1", tool: shellRunTool, args: { command: "mkdir a" } },
      { id: "c2", tool: shellRunTool, args: { command: "mkdir b" } },
    ])

    expect(request?.trust).toEqual({ kind: "shell", programs: ["mkdir"] })
    expect(request?.calls?.map((call) => call.trust)).toEqual([
      { kind: "shell", programs: ["mkdir"] },
      { kind: "shell", programs: ["mkdir"] },
    ])
  })

  it("drops the trust hint when the calls disagree", async () => {
    let request: ApprovalRequest | undefined
    const approve = createRegistryBatchApprover({
      scope: { kind: "chat" },
      onRequest: (pending) => {
        request = pending
        resolveApproval(pending.id, { approved: true })
      },
    })

    await approve([
      { id: "c1", tool: shellRunTool, args: { command: "mkdir a" } },
      { id: "c2", tool: fakeTool("fs_write", "write"), args: { path: "a" } },
    ])

    expect(request?.trust).toBeUndefined()
  })
})
