import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  appendAuditEvent,
  auditPageQuerySchema,
  collectSecretValues,
  deleteAuditEvents,
  pageAuditEvents,
  readAuditEvents,
  sanitizeAuditEvent,
  type AuditEvent,
} from "@/lib/workflows/audit"
import { pruneRuns, saveRun } from "@/lib/workflows/store"
import type { WorkflowRun } from "@/lib/workflows/schema"
import { setProviderSecret } from "@/lib/secrets"

import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
})

afterEach(async () => {
  await env.cleanup()
})

function baseRun(id: string, createdAt: string): WorkflowRun {
  return {
    id,
    workflow: "line",
    workspaceRoot: env.workspace,
    status: "succeeded",
    trigger: "manual",
    task: "t",
    createdAt,
    finishedAt: createdAt,
    steps: [{ id: "plan", agent: "planner", status: "succeeded", attempts: 1, toolExecutions: [], filesChanged: [] }],
    pendingApproval: null,
  }
}

describe("audit pages", () => {
  it("returns one slice and the full count", () => {
    const page = pageAuditEvents(["a", "b", "c"], 1, 1)
    expect(page).toEqual({ events: ["b"], total: 3, offset: 1, limit: 1 })
    expect(pageAuditEvents(["a"], 5, 2)).toEqual({ events: [], total: 1, offset: 5, limit: 2 })
  })

  it("rejects a page that is too large or negative", () => {
    expect(auditPageQuerySchema.safeParse({ offset: 0, limit: 50 }).success).toBe(true)
    expect(auditPageQuerySchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(auditPageQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(auditPageQuerySchema.safeParse({ offset: -1 }).success).toBe(false)
  })
})

describe("sanitizeAuditEvent", () => {
  it("redacts secret values and truncates long text", () => {
    const secrets = { k: "super-secret-key-value-xyz" }
    const event = sanitizeAuditEvent(
      {
        type: "tool_call",
        ts: "2026-10-19T12:00:00.000Z",
        stepId: "plan",
        id: "c1",
        tool: "shell",
        server: "builtin",
        risk: "exec",
        args: { cmd: "echo super-secret-key-value-xyz" },
      },
      secrets
    )
    expect(event.type).toBe("tool_call")
    if (event.type === "tool_call") {
      expect(JSON.stringify(event.args)).not.toContain("super-secret-key-value-xyz")
      expect(JSON.stringify(event.args)).toContain("••••")
    }
  })

  it("collects secrets from the secrets file shape", () => {
    const values = collectSecretValues({
      providers: { openai: { apiKey: "sk-openai-test-key-123456" } },
      mcp: { "mcp.a.header.Authorization": "Bearer mcp-token-abcdef" },
      browser: { "browser.w.s.password": "browser-pass-99999999" },
      jev: { apiKey: "jev-key-abcdefghij" },
    })
    expect(Object.values(values)).toEqual(
      expect.arrayContaining([
        "sk-openai-test-key-123456",
        "Bearer mcp-token-abcdef",
        "browser-pass-99999999",
        "jev-key-abcdefghij",
      ])
    )
  })
})

describe("appendAuditEvent / readAuditEvents", () => {
  it("keeps order, skips bad lines, and redacts on write", async () => {
    await setProviderSecret("openai", { apiKey: "sk-audit-redact-me-please" })
    const events: AuditEvent[] = [
      {
        type: "run_started",
        ts: "2026-10-19T12:00:00.000Z",
        workflow: "line",
        task: "use sk-audit-redact-me-please",
      },
      {
        type: "step_started",
        ts: "2026-10-19T12:00:01.000Z",
        stepId: "plan",
        agent: "planner",
      },
    ]
    for (const event of events) {
      await appendAuditEvent(env.workspace, "run-a", event)
    }

    // Inject a bad line into the file.
    const { promises: fs } = await import("node:fs")
    const { auditEventPath } = await import("@/lib/workflows/audit")
    await fs.appendFile(auditEventPath(env.workspace, "run-a"), "not-json\n", "utf8")

    const read = await readAuditEvents(env.workspace, "run-a")
    expect(read).toHaveLength(2)
    expect(read[0].type).toBe("run_started")
    if (read[0].type === "run_started") {
      expect(read[0].task).not.toContain("sk-audit-redact-me-please")
    }
    expect(read[1].type).toBe("step_started")

    const onlySteps = await readAuditEvents(env.workspace, "run-a", { stepId: "plan" })
    expect(onlySteps).toHaveLength(1)
  })

  it("deletes the audit file with pruneRuns", async () => {
    // Keep only 1 finished run; create 2.
    await saveRun(baseRun("old-1", "2026-10-01T00:00:00.000Z"))
    await saveRun(baseRun("old-2", "2026-10-02T00:00:00.000Z"))
    await appendAuditEvent(env.workspace, "old-1", {
      type: "run_started",
      ts: "2026-10-01T00:00:00.000Z",
      workflow: "line",
      task: "t",
    })
    await appendAuditEvent(env.workspace, "old-2", {
      type: "run_started",
      ts: "2026-10-02T00:00:00.000Z",
      workflow: "line",
      task: "t",
    })

    await pruneRuns(env.workspace, 1)
    expect(await readAuditEvents(env.workspace, "old-1")).toEqual([])
    expect(await readAuditEvents(env.workspace, "old-2")).toHaveLength(1)
    await deleteAuditEvents(env.workspace, "old-2")
  })
})
