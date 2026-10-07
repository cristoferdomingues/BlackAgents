import { z } from "zod"

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

export const chatContextEventSchema = z.object({ artifacts: z.array(turnArtifactSchema).default([]) })
export const chatTokenEventSchema = z.object({ content: z.string() })
export const chatToolResultEventSchema = z.object({ trace: toolTraceSchema })
export const chatApprovalRequiredEventSchema = z.object({ approval: approvalRequestSchema })
export const chatApprovalResolvedEventSchema = z.object({ id: z.string(), approved: z.boolean() })
export const chatDoneEventSchema = z.object({
  content: z.string(),
  model: z.string().optional(),
  toolExecutions: z.array(toolTraceSchema).optional(),
  stoppedAtLimit: z.boolean().optional(),
})
export const chatErrorEventSchema = z.object({ message: z.string().default("The assistant failed") })
