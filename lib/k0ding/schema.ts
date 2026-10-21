import { z } from "zod"

import { nameSchema } from "@/lib/artifacts/schemas"
import { providerIdSchema } from "@/lib/llm/provider-id"

import { K0DING_LIMITS } from "./limits"

export const codeRootIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid code folder id")

export const codeRootSchema = z.object({
  id: codeRootIdSchema,
  path: z.string().min(1).max(1_000),
  label: z.string().trim().min(1).max(K0DING_LIMITS.maxLabelChars),
  hidden: z.array(z.string().trim().min(1).max(80)).max(K0DING_LIMITS.maxHidden).default([]),
  /** Runs after Apply all. When it fails, the output goes back to the model. */
  checkCommand: z.string().trim().min(1).max(500).optional(),
})
export type CodeRoot = z.infer<typeof codeRootSchema>

export const rootsFileSchema = z.object({
  roots: z.array(codeRootSchema).max(K0DING_LIMITS.maxRoots),
})

export const createRootSchema = z.object({
  path: z.string().trim().min(1).max(1_000),
  label: z.string().trim().min(1).max(K0DING_LIMITS.maxLabelChars).optional(),
})

export const patchRootSchema = z
  .object({
    label: z.string().trim().min(1).max(K0DING_LIMITS.maxLabelChars).optional(),
    hidden: z.array(z.string().trim().min(1).max(80)).max(K0DING_LIMITS.maxHidden).optional(),
    checkCommand: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine(
    (value) => value.label !== undefined || value.hidden !== undefined || value.checkCommand !== undefined,
    "Nothing to update"
  )

export const treeQuerySchema = z.object({
  dir: z.string().max(500).default(""),
  hidden: z.enum(["0", "1"]).default("0"),
})

export const pathQuerySchema = z.object({
  path: z.string().trim().min(1).max(500),
})

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  dir: z.string().max(500).optional(),
})

export const treeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["dir", "file"]),
  secret: z.boolean(),
})
export type TreeEntry = z.infer<typeof treeEntrySchema>

export const fileViewSchema = z.object({
  path: z.string(),
  content: z.string().nullable(),
  hash: z.string().nullable(),
  bytes: z.number().int().nonnegative(),
  binary: z.boolean(),
  secret: z.boolean(),
  truncated: z.boolean(),
  message: z.string().optional(),
})
export type FileView = z.infer<typeof fileViewSchema>

export const searchMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
})
export type SearchMatch = z.infer<typeof searchMatchSchema>

export const stagedChangeSchema = z.object({
  path: z.string().trim().min(1).max(500),
  kind: z.enum(["create", "update", "delete"]),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  content: z.string().max(K0DING_LIMITS.maxFileBytes).optional(),
  state: z.enum(["pending", "applied", "discarded", "conflict"]),
})
export type StagedChange = z.infer<typeof stagedChangeSchema>

const storedToolCallSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  arguments: z.record(z.unknown()),
})

export const storedMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().max(K0DING_LIMITS.maxMessageChars),
  name: z.string().max(80).optional(),
  tool_call_id: z.string().max(80).optional(),
  tool_calls: z.array(storedToolCallSchema).max(20).optional(),
})

export const codingModelSchema = z.object({
  provider: providerIdSchema,
  model: z.string().trim().min(1).max(200),
})
export type CodingModel = z.infer<typeof codingModelSchema>

export const guidanceRefSchema = z.object({
  type: z.enum(["agent", "rule", "skill"]),
  name: nameSchema,
  source: z.enum(["user", "always", "glob"]).default("user"),
})
export type GuidanceRef = z.infer<typeof guidanceRefSchema>

export const guidancePickSchema = guidanceRefSchema.pick({ type: true, name: true })
export type GuidancePick = z.infer<typeof guidancePickSchema>

export const sessionStatusSchema = z.enum([
  "running",
  "review",
  "applied",
  "discarded",
  "interrupted",
  "failed",
])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const codingSessionSchema = z.object({
  id: z.string().uuid(),
  rootId: codeRootIdSchema,
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "must be a date"),
  status: sessionStatusSchema,
  context: z.array(z.string().min(1).max(500)).max(K0DING_LIMITS.maxContextFiles),
  model: codingModelSchema,
  messages: z.array(storedMessageSchema).max(K0DING_LIMITS.maxSessionMessages),
  changes: z.array(stagedChangeSchema).max(100),
  prompts: z.array(z.string().trim().min(1).max(K0DING_LIMITS.maxPromptChars)).max(50).default([]),
  guidance: z.array(guidanceRefSchema).max(20).default([]),
  noteProposal: z.string().max(20_000).optional(),
  /** Exact shell calls the user allowed for the rest of this session. */
  allowedCalls: z.array(z.string().min(1).max(2_000)).max(50).default([]),
})
export type CodingSession = z.infer<typeof codingSessionSchema>

export const sessionViewSchema = z.object({
  id: codingSessionSchema.shape.id,
  rootId: codeRootIdSchema,
  createdAt: codingSessionSchema.shape.createdAt,
  status: sessionStatusSchema,
  summary: z.string(),
  model: codingModelSchema,
  changes: z.array(stagedChangeSchema),
  noteProposal: z.string().max(20_000).optional(),
})
export type CodingSessionView = z.infer<typeof sessionViewSchema>

export const startSessionSchema = z.object({
  rootId: codeRootIdSchema,
  prompt: z.string().trim().min(1).max(K0DING_LIMITS.maxPromptChars),
  context: z.array(z.string().trim().min(1).max(500)).max(K0DING_LIMITS.maxContextFiles).default([]),
  guidance: z.array(guidancePickSchema).max(10).default([]),
  provider: providerIdSchema.optional(),
  model: z.string().trim().min(1).max(200).optional(),
})

export const followUpSchema = z.object({
  prompt: z.string().trim().min(1).max(K0DING_LIMITS.maxPromptChars),
  guidance: z.array(guidancePickSchema).max(10).default([]),
})

export const pathsBodySchema = z.object({
  paths: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
})

export const runCommandSchema = z.object({
  command: z.string().trim().min(1).max(8_000),
})

export const saveFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  content: z.string().max(K0DING_LIMITS.maxFileBytes),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
})

export const commandResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
})
export type CommandResult = z.infer<typeof commandResultSchema>

export const projectNotesSchema = z.object({
  content: z.string().max(20_000),
})

export const k0dingDraftRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("skill"),
    name: nameSchema,
  }),
  z.object({
    kind: z.literal("workflow"),
    name: nameSchema,
    agent: nameSchema,
  }),
])

export const mcpTrySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, dashes, or underscores"),
  script: z.string().trim().min(1).max(100),
})

export function sessionView(session: CodingSession): CodingSessionView {
  const summary =
    [...session.messages].reverse().find((message) => message.role === "assistant" && message.content.trim())
      ?.content ?? ""
  return {
    id: session.id,
    rootId: session.rootId,
    createdAt: session.createdAt,
    status: session.status,
    summary,
    model: session.model,
    changes: session.changes,
    ...(session.noteProposal ? { noteProposal: session.noteProposal } : {}),
  }
}
