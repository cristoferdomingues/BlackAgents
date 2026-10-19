import { z } from "zod"

import { ProposalError, proposeConceptReverification } from "@/lib/brain/learn"

import type { RuntimeTool, ToolOutcome } from "../types"
import { toolArgsError } from "./args"

const reverifyArgs = z.object({
  conceptId: z.string().trim().min(1).max(300),
  reason: z.string().trim().min(1).max(2_000),
})

export const brainProposeReverificationTool: RuntimeTool = {
  name: "brain_propose_reverification",
  originalName: "brain_propose_reverification",
  server: "builtin",
  source: "builtin",
  risk: "write",
  description:
    "Add one existing knowledge concept to the Brain inbox for human re-verification. This never edits the concept.",
  parameters: {
    type: "object",
    properties: {
      conceptId: {
        type: "string",
        description:
          "Concept id relative to .black-agents/knowledge, without the .md suffix, for example architecture/workflows",
      },
      reason: {
        type: "string",
        description: "Short evidence explaining why this concept needs human review",
      },
    },
    required: ["conceptId", "reason"],
    additionalProperties: false,
  },
  summarize: (args) => `Propose re-verification of ${String(args.conceptId ?? "a concept")}`,
  async execute(args, ctx): Promise<ToolOutcome> {
    const parsed = reverifyArgs.safeParse(args)
    if (!parsed.success) return { error: toolArgsError(parsed.error) }
    try {
      const { proposal, created } = await proposeConceptReverification(
        ctx.workspaceRoot,
        {
          conceptId: parsed.data.conceptId,
          reason: parsed.data.reason,
          runId: ctx.runId,
        }
      )
      return {
        result: {
          proposalId: proposal.id,
          conceptId: proposal.target?.name,
          created,
          status: proposal.status,
        },
      }
    } catch (err) {
      return {
        error: err instanceof ProposalError ? err.message : "Could not create the re-verification proposal",
      }
    }
  },
}
