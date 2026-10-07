import { afterEach, describe, expect, it, vi } from "vitest"

import {
  callKey,
  createApprovalPolicy,
  needsApproval,
  rememberCall,
} from "@/lib/runtime/approval-policy"
import {
  getPendingApproval,
  listPendingApprovals,
  requestApproval,
  resolveApproval,
} from "@/lib/runtime/approvals"
import { createRegistryApprover, denyAllApprover } from "@/lib/runtime/ask-user"

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

  it("uses per-call risk and remembers exact calls", () => {
    const tool = { ...fakeTool("fs", "write"), riskFor: () => "exec" as const }
    const policy = createApprovalPolicy(true)
    expect(needsApproval(tool, { a: 1 }, policy)).toBe(true)
    rememberCall(policy, tool, { a: 1 })
    expect(needsApproval(tool, { a: 1 }, policy)).toBe(false)
    expect(needsApproval(tool, { a: 2 }, policy)).toBe(true)
  })

  it("builds the same key regardless of argument order", () => {
    const tool = fakeTool("t", "exec")
    expect(callKey(tool, { a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      callKey(tool, { b: [1, { d: 3, c: 2 }], a: 1 })
    )
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
})
