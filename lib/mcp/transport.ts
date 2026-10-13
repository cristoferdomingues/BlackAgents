import type { McpServerConfig, McpTransportType } from "@/lib/mcp/types"

/**
 * Pick how to connect.
 * A URL with no transport uses HTTP POST. SSE is used only when the user picks it.
 * Streamable HTTP servers answer 405 to a GET, so they must not use the SSE client.
 */
export function resolveMcpTransport(config: McpServerConfig): McpTransportType {
  if (config.transport === "http" || config.transport === "sse" || config.transport === "stdio") {
    return config.transport
  }
  if (config.url) return "http"
  if (config.command) return "stdio"
  throw new Error("Invalid MCP server config: either 'command' or 'url' is required")
}

/** Headers sent on every request to a remote MCP server. */
export function mcpAuthRequestInit(config: McpServerConfig): RequestInit | undefined {
  const headers = config.headers
  if (!headers || Object.keys(headers).length === 0) return undefined
  return { headers }
}
