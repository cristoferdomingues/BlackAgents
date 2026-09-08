import { z } from "zod"

export type McpTransportType = "stdio" | "sse"

export const mcpServerConfigSchema = z.object({
  command: z.string().trim().optional(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional().default({}),
  url: z.string().trim().optional(),
  transport: z.enum(["stdio", "sse"]).optional(),
  disabled: z.boolean().optional().default(false),
})

export type McpServerConfigInput = z.input<typeof mcpServerConfigSchema>
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>

export const mcpConfigSchema = z.object({
  mcpServers: z.record(mcpServerConfigSchema).default({}),
})

export type McpConfig = z.infer<typeof mcpConfigSchema>

export interface McpTool {
  server: string
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolExecutionTrace {
  id: string
  server: string
  tool: string
  args: Record<string, unknown>
  result?: unknown
  error?: string
  durationMs?: number
}

export interface McpServerStatus {
  name: string
  config: McpServerConfig
  status: "connected" | "error" | "disabled"
  tools: McpTool[]
  error?: string
}
