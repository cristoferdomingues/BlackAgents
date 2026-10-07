"use client"

import * as React from "react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { McpTrust } from "@/lib/mcp/policy"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const OPTIONS: Array<{ value: McpTrust; label: string; hint: string }> = [
  { value: "trusted", label: "Trusted", hint: "Calls run without asking" },
  { value: "ask", label: "Ask", hint: "Asks unless file writes are allowed" },
  { value: "risky", label: "Risky", hint: "Asks for every call" },
]

/** Per-server trust level, stored in `.black-agents/mcp-policy.json`. */
export function McpTrustSelect({ server, value }: { server: string; value: McpTrust }) {
  const [trust, setTrust] = React.useState<McpTrust>(value)

  async function change(next: string) {
    const previous = trust
    const option = OPTIONS.find((o) => o.value === next)
    if (!option) return
    setTrust(option.value)
    try {
      await apiFetch("/api/mcp/policy", {
        method: "PUT",
        body: JSON.stringify({ server, trust: option.value }),
      })
      toast.success(`${server}: ${option.label}`)
    } catch (err) {
      setTrust(previous)
      toast.error(err instanceof Error ? err.message : "Could not save the trust level")
    }
  }

  return (
    <Select value={trust} onValueChange={(v) => void change(v)}>
      <SelectTrigger className="h-7 w-28 text-xs" aria-label={`Trust level for ${server}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} title={o.hint}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
