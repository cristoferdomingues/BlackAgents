import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
  ToolCall,
} from "@/lib/llm/types"
import type { RuntimeTool, ToolRisk } from "@/lib/runtime/types"

/** A provider that replays scripted replies and records each request. */
export function scriptedProvider(
  replies: Array<{ content?: string; toolCalls?: ToolCall[] } | Error>
): LLMProvider & { requests: LLMGenerateRequest[] } {
  const requests: LLMGenerateRequest[] = []
  let index = 0
  return {
    id: "openai",
    label: "Scripted",
    models: ["scripted"],
    requests,
    async verify() {},
    async generate(request): Promise<LLMGenerateResult> {
      requests.push(structuredClone(request))
      const reply = replies[Math.min(index, replies.length - 1)]
      index++
      if (reply instanceof Error) throw reply
      return { content: reply.content ?? "", model: request.model, toolCalls: reply.toolCalls }
    },
  }
}

export function fakeTool(
  name: string,
  risk: ToolRisk,
  run: (args: Record<string, unknown>) => unknown = (args) => ({ echo: args })
): RuntimeTool & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  return {
    name,
    originalName: name,
    server: "builtin",
    source: "builtin",
    risk,
    description: `fake ${name}`,
    parameters: { type: "object", properties: {} },
    calls,
    async execute(args) {
      calls.push(args)
      return { result: run(args) }
    },
  }
}

export function call(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, name, arguments: args }
}
