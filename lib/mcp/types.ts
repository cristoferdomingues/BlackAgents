import { z } from "zod"

export type McpTransportType = "stdio" | "sse" | "http"

/** Redacted secret status safe to send to the client (matches `KeyStatus`). */
export interface McpSecretStatus {
  configured: boolean
  last4?: string
}

/** True when `value` is an absolute http or https URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

const mcpHeaderNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/,
    "Use a valid HTTP header name"
  )

const mcpHeaderValueSchema = z
  .string()
  .min(1, "Header value is required")
  .refine((value) => !/[\r\n]/.test(value), "Header value cannot contain line breaks")

export const mcpServerConfigSchema = z
  .object({
    command: z.string().trim().optional(),
    args: z.array(z.string()).optional().default([]),
    env: z.record(z.string()).optional().default({}),
    url: z
      .string()
      .trim()
      .min(1, "URL is required")
      .refine(isHttpUrl, "URL must start with http:// or https://")
      .optional(),
    headers: z.record(mcpHeaderNameSchema, mcpHeaderValueSchema).optional().default({}),
    transport: z.enum(["stdio", "sse", "http"]).optional(),
    disabled: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if ((value.transport === "http" || value.transport === "sse") && !value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL is required for an HTTP or SSE server",
        path: ["url"],
      })
    }
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
  /** Redacted status for `${secret:…}` refs on this server (safe for the client). */
  secretStatuses?: Record<string, McpSecretStatus>
}
