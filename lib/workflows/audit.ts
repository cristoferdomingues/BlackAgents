import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { pathExists, removePath, resolveInWorkspace } from "@/lib/fs-service"
import type { ChatMessage, TokenUsage, ToolCall } from "@/lib/llm/types"
import { redactSecretValues } from "@/lib/mcp/resolve-secrets"
import { truncateResult } from "@/lib/runtime/agent-loop"
import type { ToolRisk } from "@/lib/runtime/types"
import { readSecrets, type SecretsFile } from "@/lib/secrets"

import { RUNS_DIR } from "./store"

export const AUDIT_PAYLOAD_MAX_CHARS = 20_000

export {
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  auditPageQuerySchema,
  pageAuditEvents,
  type AuditPage,
} from "./audit-page"

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
})

const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
})

const auditBase = z.object({
  ts: z.string(),
  stepId: z.string().optional(),
  attempt: z.number().int().optional(),
  turn: z.number().int().optional(),
})

export const auditEventSchema = z.discriminatedUnion("type", [
  auditBase.extend({ type: z.literal("run_started"), workflow: z.string(), task: z.string() }),
  auditBase.extend({ type: z.literal("step_started"), agent: z.string(), model: z.string().optional(), provider: z.string().optional() }),
  auditBase.extend({
    type: z.literal("llm_request"),
    model: z.string(),
    provider: z.string(),
    systemContext: z.string().optional(),
    messages: z.array(chatMessageSchema),
  }),
  auditBase.extend({
    type: z.literal("llm_response"),
    model: z.string(),
    provider: z.string(),
    content: z.string(),
    reasoning: z.string().optional(),
    toolCalls: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        })
      )
      .optional(),
    durationMs: z.number().nonnegative(),
    usage: tokenUsageSchema.optional(),
  }),
  auditBase.extend({
    type: z.literal("tool_call"),
    tool: z.string(),
    server: z.string(),
    risk: z.enum(["read", "write", "exec"]),
    args: z.record(z.string(), z.unknown()),
    id: z.string(),
  }),
  auditBase.extend({
    type: z.literal("tool_result"),
    id: z.string(),
    tool: z.string(),
    server: z.string(),
    result: z.string().optional(),
    error: z.string().optional(),
    durationMs: z.number().nonnegative(),
  }),
  auditBase.extend({
    type: z.literal("tool_limit"),
    requested: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    reason: z.enum(["per_turn", "total"]),
  }),
  auditBase.extend({
    type: z.literal("context_compacted"),
    removedMessages: z.number().int().positive(),
  }),
  auditBase.extend({
    type: z.literal("approval_requested"),
    approvalId: z.string(),
    tool: z.string(),
    summary: z.string(),
  }),
  auditBase.extend({
    type: z.literal("approval_resolved"),
    approvalId: z.string(),
    approved: z.boolean(),
  }),
  auditBase.extend({ type: z.literal("login_pause"), reason: z.string() }),
  auditBase.extend({ type: z.literal("retry"), reason: z.string() }),
  auditBase.extend({
    type: z.literal("review_sent_back"),
    targetStep: z.string(),
    round: z.number().int().positive(),
    maxRounds: z.number().int().positive(),
    reasons: z.string(),
  }),
  auditBase.extend({
    type: z.literal("gate"),
    decision: z.enum(["continue", "retry", "stop"]),
    by: z.enum(["jev", "default"]),
    confidence: z.number().optional(),
  }),
  auditBase.extend({
    type: z.literal("step_finished"),
    status: z.enum(["succeeded", "failed", "skipped"]),
    error: z.string().optional(),
  }),
  auditBase.extend({
    type: z.literal("run_finished"),
    status: z.enum(["succeeded", "failed", "cancelled"]),
    error: z.string().optional(),
  }),
  auditBase.extend({ type: z.literal("error"), message: z.string() }),
])

export type AuditEvent = z.infer<typeof auditEventSchema>
export type AuditEventType = AuditEvent["type"]

/** Groups used by the Timeline filters. */
export type AuditFilterGroup = "ai" | "tools" | "approvals" | "errors" | "lifecycle"

const FILTER_GROUPS: Record<AuditFilterGroup, readonly AuditEventType[]> = {
  ai: ["llm_request", "llm_response"],
  tools: ["tool_call", "tool_result", "tool_limit"],
  approvals: ["approval_requested", "approval_resolved", "login_pause"],
  errors: ["error"],
  lifecycle: ["run_started", "step_started", "step_finished", "run_finished", "retry", "gate", "review_sent_back", "context_compacted"],
}

export function auditTypesForGroup(group: AuditFilterGroup): readonly AuditEventType[] {
  return FILTER_GROUPS[group]
}

export function auditEventPath(root: string, runId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid run id")
  return resolveInWorkspace(root, `${RUNS_DIR}/${runId}.events.jsonl`)
}

/** Flatten every secret string from the secrets file for redaction. */
export function collectSecretValues(secrets: SecretsFile): Record<string, string> {
  const out: Record<string, string> = {}
  let n = 0
  const add = (value: string | undefined): void => {
    if (!value?.trim()) return
    out[`s${n++}`] = value
  }
  for (const provider of Object.values(secrets.providers)) {
    add(provider?.apiKey)
  }
  add(secrets.jev?.apiKey)
  add(secrets.jev?.openRouterApiKey)
  if (secrets.mcp) for (const value of Object.values(secrets.mcp)) add(value)
  if (secrets.browser) for (const value of Object.values(secrets.browser)) add(value)
  return out
}

function redactText(text: string, secrets: Record<string, string>): string {
  return truncateResult(redactSecretValues(text, secrets), AUDIT_PAYLOAD_MAX_CHARS)
}

function redactUnknown(value: unknown, secrets: Record<string, string>): unknown {
  if (typeof value === "string") return redactText(value, secrets)
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, secrets))
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = redactUnknown(item, secrets)
    }
    return next
  }
  return value
}

function redactMessages(messages: ChatMessage[], secrets: Record<string, string>): ChatMessage[] {
  return messages.map((m) => ({
    ...m,
    content: redactText(m.content, secrets),
    tool_calls: m.tool_calls?.map((tc) => ({
      ...tc,
      arguments: redactUnknown(tc.arguments, secrets) as Record<string, unknown>,
    })),
  }))
}

function redactToolCalls(calls: ToolCall[] | undefined, secrets: Record<string, string>): ToolCall[] | undefined {
  if (!calls) return undefined
  return calls.map((tc) => ({
    ...tc,
    arguments: redactUnknown(tc.arguments, secrets) as Record<string, unknown>,
  }))
}

/** Strip secrets and cap size before writing. */
export function sanitizeAuditEvent(event: AuditEvent, secrets: Record<string, string>): AuditEvent {
  switch (event.type) {
    case "run_started":
      return { ...event, task: redactText(event.task, secrets) }
    case "llm_request":
      return {
        ...event,
        systemContext: event.systemContext ? redactText(event.systemContext, secrets) : undefined,
        messages: redactMessages(event.messages as ChatMessage[], secrets),
      }
    case "llm_response":
      return {
        ...event,
        content: redactText(event.content, secrets),
        reasoning: event.reasoning ? redactText(event.reasoning, secrets) : undefined,
        toolCalls: redactToolCalls(event.toolCalls as ToolCall[] | undefined, secrets),
      }
    case "tool_call":
      return {
        ...event,
        args: redactUnknown(event.args, secrets) as Record<string, unknown>,
      }
    case "tool_result":
      return {
        ...event,
        result: event.result ? redactText(event.result, secrets) : undefined,
        error: event.error ? redactText(event.error, secrets) : undefined,
      }
    case "approval_requested":
      return { ...event, summary: redactText(event.summary, secrets) }
    case "login_pause":
      return { ...event, reason: redactText(event.reason, secrets) }
    case "retry":
      return { ...event, reason: redactText(event.reason, secrets) }
    case "review_sent_back":
      return { ...event, reasons: redactText(event.reasons, secrets) }
    case "step_finished":
      return { ...event, error: event.error ? redactText(event.error, secrets) : undefined }
    case "run_finished":
      return { ...event, error: event.error ? redactText(event.error, secrets) : undefined }
    case "error":
      return { ...event, message: redactText(event.message, secrets) }
    default:
      return event
  }
}

const writeQueues = new Map<string, Promise<void>>()

function queueKey(root: string, runId: string): string {
  return `${root}::${runId}`
}

/**
 * Append one audit event. Failures are swallowed so the run never fails
 * because of logging. Writes for the same run are serialized.
 */
export async function appendAuditEvent(
  root: string,
  runId: string,
  event: AuditEvent
): Promise<void> {
  const key = queueKey(root, runId)
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        const secrets = collectSecretValues(await readSecrets())
        const safe = sanitizeAuditEvent(event, secrets)
        const abs = auditEventPath(root, runId)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.appendFile(abs, `${JSON.stringify(safe)}\n`, "utf8")
      } catch {
        // Audit must never break a run.
      }
    })
    .finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key)
    })
  writeQueues.set(key, next)
  await next
}

export interface ReadAuditOptions {
  stepId?: string
  types?: readonly AuditEventType[]
}

/** Read and validate audit lines; skip bad lines. */
export async function readAuditEvents(
  root: string,
  runId: string,
  options: ReadAuditOptions = {}
): Promise<AuditEvent[]> {
  const abs = auditEventPath(root, runId)
  if (!(await pathExists(abs))) return []
  let text: string
  try {
    text = await fs.readFile(abs, "utf8")
  } catch {
    return []
  }
  const out: AuditEvent[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed) as unknown
    } catch {
      continue
    }
    const parsed = auditEventSchema.safeParse(raw)
    if (!parsed.success) continue
    if (options.stepId && parsed.data.stepId !== options.stepId) continue
    if (options.types && !options.types.includes(parsed.data.type)) continue
    out.push(parsed.data)
  }
  return out
}

/** Raw jsonl body for download (already redacted on write). */
export async function readAuditJsonl(root: string, runId: string): Promise<string> {
  const abs = auditEventPath(root, runId)
  if (!(await pathExists(abs))) return ""
  try {
    return await fs.readFile(abs, "utf8")
  } catch {
    return ""
  }
}

export async function deleteAuditEvents(root: string, runId: string): Promise<void> {
  const abs = auditEventPath(root, runId)
  if (await pathExists(abs)) await removePath(abs)
}

/** Helpers to build common audit events with a shared timestamp. */
export function auditNow(): string {
  return new Date().toISOString()
}

export function llmRequestEvent(params: {
  stepId: string
  attempt: number
  turn: number
  model: string
  provider: string
  systemContext?: string
  messages: ChatMessage[]
}): AuditEvent {
  return {
    type: "llm_request",
    ts: auditNow(),
    stepId: params.stepId,
    attempt: params.attempt,
    turn: params.turn,
    model: params.model,
    provider: params.provider,
    systemContext: params.systemContext,
    messages: params.messages,
  }
}

export function llmResponseEvent(params: {
  stepId: string
  attempt: number
  turn: number
  model: string
  provider: string
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  durationMs: number
  usage?: TokenUsage
}): AuditEvent {
  return {
    type: "llm_response",
    ts: auditNow(),
    stepId: params.stepId,
    attempt: params.attempt,
    turn: params.turn,
    model: params.model,
    provider: params.provider,
    content: params.content,
    reasoning: params.reasoning,
    toolCalls: params.toolCalls,
    durationMs: params.durationMs,
    usage: params.usage,
  }
}

export function toolCallEvent(params: {
  stepId: string
  attempt: number
  turn?: number
  id: string
  tool: string
  server: string
  risk: ToolRisk
  args: Record<string, unknown>
}): AuditEvent {
  return {
    type: "tool_call",
    ts: auditNow(),
    stepId: params.stepId,
    attempt: params.attempt,
    turn: params.turn,
    id: params.id,
    tool: params.tool,
    server: params.server,
    risk: params.risk,
    args: params.args,
  }
}
