"use client"

import * as React from "react"

import {
  BUILTIN_TOOL_LABELS,
  BUILTIN_TOOL_NAMES,
  type BuiltinToolName,
} from "@/lib/runtime/tool-names"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

/** Agent tool scope: built-in tools + optional MCP server allowlist. */
export function AgentToolsField({
  tools,
  mcpServers,
  onToolsChange,
  onMcpServersChange,
}: {
  tools: BuiltinToolName[]
  mcpServers: string[]
  onToolsChange: (tools: BuiltinToolName[]) => void
  onMcpServersChange: (servers: string[]) => void
}) {
  const [serversText, setServersText] = React.useState(mcpServers.join(", "))
  const [lastSynced, setLastSynced] = React.useState(mcpServers)
  if (lastSynced !== mcpServers) {
    setLastSynced(mcpServers)
    setServersText(mcpServers.join(", "))
  }

  return (
    <div className="space-y-3 rounded-md border px-3 py-2">
      <div>
        <p className="text-sm font-medium">Tools</p>
        <p className="text-xs text-muted-foreground">
          What this agent may use in chat and workflows. Risky calls always ask you first.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {BUILTIN_TOOL_NAMES.map((name) => {
          const id = `tool-${name}`
          return (
            <div key={name} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Label htmlFor={id} className="text-sm">
                  {BUILTIN_TOOL_LABELS[name].label}
                </Label>
                <p className="text-[11px] text-muted-foreground">{BUILTIN_TOOL_LABELS[name].hint}</p>
              </div>
              <Switch
                id={id}
                checked={tools.includes(name)}
                onCheckedChange={(on) =>
                  onToolsChange(on ? [...tools, name] : tools.filter((t) => t !== name))
                }
              />
            </div>
          )
        })}
      </div>
      <div className="space-y-1">
        <Label htmlFor="agent-mcp-servers" className="text-sm">
          MCP servers
        </Label>
        <Input
          id="agent-mcp-servers"
          placeholder="All workspace servers"
          value={serversText}
          onChange={(e) => setServersText(e.target.value)}
          onBlur={() =>
            onMcpServersChange(
              serversText
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
        />
        <p className="text-[11px] text-muted-foreground">Comma-separated. Leave empty to allow every server.</p>
      </div>
    </div>
  )
}
