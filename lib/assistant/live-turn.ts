import type { SseEvent } from "../sse-client"
import type { ApprovalRequest } from "../runtime/types"
import {
  chatApprovalRequiredEventSchema,
  chatApprovalResolvedEventSchema,
  chatContextEventSchema,
  type ChatContextModel,
  chatThinkingEventSchema,
  chatTokenEventSchema,
  chatToolCallEventSchema,
  chatToolResultEventSchema,
} from "./chat-events"
import { addReasoning, addToolCall, completeToolCall, type ThinkingStep } from "./thinking"
import type { TurnArtifact } from "./turn-artifacts"

/** The assistant reply while it is still streaming. */
export interface LiveTurn {
  content: string
  thinking: ThinkingStep[]
  approvals: ApprovalRequest[]
  artifacts: TurnArtifact[]
  model?: ChatContextModel
  /** Older messages are being summarized before the reply starts. */
  folding?: boolean
}

export const EMPTY_LIVE: LiveTurn = { content: "", thinking: [], approvals: [], artifacts: [] }

/** Fold one chat SSE event into the live turn. Unknown or malformed events change nothing. */
export function applyChatEvent(live: LiveTurn, { event, data }: SseEvent): LiveTurn {
  switch (event) {
    case "context": {
      const parsed = chatContextEventSchema.safeParse(data)
      if (!parsed.success) return live
      return {
        ...live,
        artifacts: parsed.data.artifacts,
        ...(parsed.data.model ? { model: parsed.data.model } : {}),
      }
    }
    case "memory_folding":
      return { ...live, folding: true }
    case "thinking": {
      const parsed = chatThinkingEventSchema.safeParse(data)
      return parsed.success ? { ...live, thinking: addReasoning(live.thinking, parsed.data.content) } : live
    }
    case "token": {
      const parsed = chatTokenEventSchema.safeParse(data)
      return parsed.success ? { ...live, folding: false, content: parsed.data.content } : live
    }
    case "tool_call": {
      const parsed = chatToolCallEventSchema.safeParse(data)
      if (!parsed.success) return live
      return { ...live, folding: false, content: "", thinking: addToolCall(live.thinking, parsed.data, live.content) }
    }
    case "tool_result": {
      const parsed = chatToolResultEventSchema.safeParse(data)
      return parsed.success
        ? { ...live, thinking: completeToolCall(live.thinking, parsed.data.trace) }
        : live
    }
    case "approval_required": {
      const parsed = chatApprovalRequiredEventSchema.safeParse(data)
      return parsed.success ? { ...live, approvals: [...live.approvals, parsed.data.approval] } : live
    }
    case "approval_resolved": {
      const parsed = chatApprovalResolvedEventSchema.safeParse(data)
      return parsed.success ? { ...live, approvals: live.approvals.filter((a) => a.id !== parsed.data.id) } : live
    }
    default:
      return live
  }
}
