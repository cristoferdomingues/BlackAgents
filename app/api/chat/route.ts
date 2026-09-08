import { z } from "zod"

import { ok, fail, handle } from "@/lib/api-response"
import { findArtifact } from "@/lib/artifacts/parser"
import { nameSchema } from "@/lib/artifacts/schemas"
import { readConfig } from "@/lib/config"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { getProvider, isProviderId } from "@/lib/llm/registry"
import {
  buildAgentPersonaContext,
  buildSystemContext,
} from "@/lib/llm/context"
import {
  ProviderError,
  type ChatMessage,
  type LLMToolDefinition,
} from "@/lib/llm/types"
import { executeWorkspaceTool, loadWorkspaceTools } from "@/lib/mcp/client"
import type { ToolExecutionTrace } from "@/lib/mcp/types"

const chatRequestSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1, "At least one message is required"),
  temperature: z.number().finite().min(0).max(2).optional(),
  agent: nameSchema.optional(),
})

/**
 * Bring-your-own-key chat. The API key stays server-side: it is read from the
 * local secrets file, never accepted from or returned to the client. The
 * authoring standards + workspace registry are injected as system context.
 * When MCP servers are active in the workspace, their tools are made available
 * for autonomous invocation during chat.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const parsed = chatRequestSchema.safeParse(
      await req.json().catch(() => null)
    )
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    }
    const body = parsed.data

    if (!isProviderId(body.provider)) {
      return fail("Unknown provider")
    }
    const provider = getProvider(body.provider)
    if (!provider) return fail("Unknown provider")

    const model = body.model?.trim() || provider.models[0]
    if (!model) return fail("A model is required for this provider")

    const config = await readConfig()
    let systemContext: string
    if (body.agent) {
      const agent = config.currentPath
        ? await findArtifact(config.currentPath, "agent", body.agent)
        : null
      if (!agent) return fail(`Agent "${body.agent}" was not found`, 404)
      systemContext = buildAgentPersonaContext(agent)
    } else {
      systemContext = await buildSystemContext()
    }

    let toolDefs: LLMToolDefinition[] = []
    const toolMap = new Map<string, { server: string; name: string }>()
    if (config.currentPath) {
      try {
        const workspaceTools = await loadWorkspaceTools(config.currentPath)
        toolDefs = workspaceTools.map((t) => {
          const toolKey = toolMap.has(t.name) ? `${t.server}__${t.name}` : t.name
          toolMap.set(toolKey, { server: t.server, name: t.name })
          return {
            name: toolKey,
            description: `[Server: ${t.server}] ${t.description ?? ""}`.trim(),
            parameters: t.inputSchema,
          }
        })
      } catch {
        toolDefs = []
      }
    }

    let verified: Awaited<ReturnType<typeof getVerifiedCredentials>>
    try {
      verified = await getVerifiedCredentials(provider)
    } catch (error) {
      if (error instanceof CredentialStateError) {
        return fail(error.message, error.status)
      }
      throw error
    }

    const MAX_TOOL_TURNS = 5
    const toolExecutions: ToolExecutionTrace[] = []
    const messages: ChatMessage[] = [...body.messages]
    let finalContent = ""

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      let result: Awaited<ReturnType<typeof provider.generate>>
      try {
        result = await provider.generate(
          {
            model,
            messages,
            temperature: body.temperature,
            systemContext,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
          },
          verified.credentials
        )
      } catch (err) {
        if (err instanceof ProviderError) {
          await markInvalidOnAuthFailure(provider, err, verified.secret)
          return fail(err.message, err.status)
        }
        throw err
      }

      finalContent = result.content

      if (!result.toolCalls || result.toolCalls.length === 0) {
        break
      }

      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      })

      for (const tc of result.toolCalls) {
        const target = toolMap.get(tc.name) ?? {
          server: tc.name.includes("__") ? tc.name.split("__")[0] : "",
          name: tc.name.includes("__") ? tc.name.split("__").slice(1).join("__") : tc.name,
        }

        const trace = await executeWorkspaceTool(
          config.currentPath!,
          target.server,
          target.name,
          tc.arguments
        )
        trace.id = tc.id
        toolExecutions.push(trace)

        messages.push({
          role: "tool",
          name: tc.name,
          tool_call_id: tc.id,
          content: JSON.stringify(trace.result ?? { error: trace.error }),
        })
      }
    }

    return ok({
      content: finalContent,
      model,
      toolExecutions: toolExecutions.length > 0 ? toolExecutions : undefined,
    })
  })
}
