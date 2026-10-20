import { ok, fail, handle } from "@/lib/api-response"
import { resolveScopeParam } from "@/lib/artifacts/scope-request"
import { chatRequestSchema, prepareChat, runChat } from "@/lib/assistant/chat-service"
import { readConfig } from "@/lib/config"
import { markInvalidOnAuthFailure } from "@/lib/llm/credentials"
import { ProviderError } from "@/lib/llm/types"
import { AgentContextLimitError, LoopAbortedError } from "@/lib/runtime/agent-loop"
import { createRegistryApprover, denyAllApprover } from "@/lib/runtime/ask-user"
import { sseResponse } from "@/lib/sse"

const CONTEXT_LIMIT_MESSAGE =
  "This message is too large for the model, even after older messages were summarized. Start a new chat or attach less."

/**
 * Bring-your-own-key chat. The API key stays server-side. The reply runs the
 * shared bounded tool loop (MCP + built-in tools). With `Accept:
 * text/event-stream` the turn streams events and risky calls wait for the
 * user's approval; the JSON mode denies anything that needs approval.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    }
    const { currentPath } = await readConfig()
    const scope = currentPath ? await resolveScopeParam(currentPath, req.url) : { ok: true as const, scope: undefined }
    if (!scope.ok) return fail(scope.error, scope.status)
    const prepared = await prepareChat(parsed.data, scope.scope)
    if (!prepared.ok) return fail(prepared.message, prepared.status)
    const chat = prepared.chat

    const streaming = req.headers.get("accept")?.includes("text/event-stream") ?? false
    if (!streaming) {
      try {
        const result = await runChat(chat, { approve: denyAllApprover })
        return ok({
          content: result.content,
          model: chat.model,
          toolExecutions: result.toolExecutions.length > 0 ? result.toolExecutions : undefined,
          artifacts: chat.selection.artifacts,
          ...(result.memory ? { memory: result.memory } : {}),
        })
      } catch (err) {
        if (err instanceof ProviderError) {
          await markInvalidOnAuthFailure(chat.provider, err, chat.secret)
          return fail(err.message, err.status)
        }
        if (err instanceof AgentContextLimitError) return fail(CONTEXT_LIMIT_MESSAGE, 413)
        throw err
      }
    }

    return sseResponse(async (send, signal) => {
      send("context", {
        artifacts: chat.selection.artifacts,
        jev: chat.selection.jev,
        tools: chat.tools.length,
        model: {
          provider: chat.provider.id,
          model: chat.model,
          source: chat.modelSource,
          ...(chat.modelTask ? { task: chat.modelTask } : {}),
        },
      })
      try {
        const result = await runChat(chat, {
          signal,
          approve: createRegistryApprover({
            scope: { kind: "chat" },
            signal,
            onRequest: (approval) => send("approval_required", { approval }),
            onResolved: (approval, decision) =>
              send("approval_resolved", { id: approval.id, approved: decision.approved }),
          }),
          onEvent: (event) => send(event.type, event),
          onMemoryFolding: () => send("memory_folding", {}),
        })
        send("done", {
          content: result.content,
          model: chat.model,
          toolExecutions: result.toolExecutions,
          stoppedAtLimit: result.stoppedAtLimit,
          ...(result.memory ? { memory: result.memory } : {}),
        })
      } catch (err) {
        if (err instanceof LoopAbortedError) return
        if (err instanceof ProviderError) {
          await markInvalidOnAuthFailure(chat.provider, err, chat.secret)
          send("error", { message: err.message, status: err.status })
          return
        }
        if (err instanceof AgentContextLimitError) {
          send("error", { message: CONTEXT_LIMIT_MESSAGE, status: 413 })
          return
        }
        throw err
      }
    }, req.signal)
  })
}
