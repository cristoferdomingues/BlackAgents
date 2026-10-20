import { z } from "zod"

import { conversationMemorySchema } from "@/lib/chat/memory"

/**
 * Schemas for the chat SSE events (isomorphic). The client parses each event
 * with these instead of trusting the stream's shape.
 */

export const toolTraceSchema = z.object({
  id: z.string(),
  server: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
})

export const approvalRequestSchema = z.object({
  id: z.string(),
  tool: z.string(),
  server: z.string(),
  risk: z.enum(["read", "write", "exec"]),
  summary: z.string(),
  args: z.record(z.unknown()),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("chat") }),
    z.object({ kind: z.literal("run"), runId: z.string(), stepId: z.string(), workflow: z.string() }),
  ]),
  createdAt: z.string(),
})

export const turnArtifactSchema = z.object({
  type: z.enum(["agent", "command", "rule", "skill"]),
  name: z.string(),
  source: z.enum(["mention", "auto", "linked"]),
})

export const chatContextModelSchema = z.object({
  provider: z.enum(["openai", "anthropic", "custom"]),
  model: z.string(),
  source: z.enum(["step", "agent", "workflow", "assistant"]),
  task: z.enum(["vision", "fast", "reasoning"]).optional(),
})
export type ChatContextModel = z.infer<typeof chatContextModelSchema>

export const chatContextEventSchema = z.object({
  artifacts: z.array(turnArtifactSchema).default([]),
  /** A bad model object is ignored so the rest of the event still applies. */
  model: chatContextModelSchema.optional().catch(undefined),
})
export const chatTokenEventSchema = z.object({ content: z.string() })
export const chatThinkingEventSchema = z.object({ turn: z.number().optional(), content: z.string() })
export const chatToolCallEventSchema = z.object({
  id: z.string(),
  tool: z.string(),
  server: z.string(),
  args: z.record(z.unknown()).default({}),
})
export const chatToolResultEventSchema = z.object({ trace: toolTraceSchema })
export const chatApprovalRequiredEventSchema = z.object({ approval: approvalRequestSchema })
export const chatApprovalResolvedEventSchema = z.object({ id: z.string(), approved: z.boolean() })
export const chatDoneEventSchema = z.object({
  content: z.string(),
  model: z.string().optional(),
  toolExecutions: z.array(toolTraceSchema).optional(),
  stoppedAtLimit: z.boolean().optional(),
  /** A bad memory is dropped; the reply itself still applies. */
  memory: conversationMemorySchema.optional().catch(undefined),
})
export const chatErrorEventSchema = z.object({ message: z.string().default("The assistant failed") })
