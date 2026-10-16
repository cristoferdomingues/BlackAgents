"use client"

import * as React from "react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { McpTrust } from "@/lib/mcp/policy"
import { TRUST_LEVELS } from "@/lib/settings/explain"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Per-server trust level, stored in `.black-agents/mcp-policy.json`. */
export function McpTrustSelect({ server, value }: { server: string; value: McpTrust }) {
  const [trust, setTrust] = React.useState<McpTrust>(value)

  async function change(next: string) {
    const previous = trust
    const option = TRUST_LEVELS.find((o) => o.value === next)
    if (!option) return
    setTrust(option.value)
    try {
      await apiFetch("/api/mcp/policy", {
        method: "PUT",
        body: JSON.stringify({ server, trust: option.value }),
      })
      toast.success(`${server} is now ${option.label}. ${option.hint}`)
    } catch (err) {
      setTrust(previous)
      toast.error(err instanceof Error ? err.message : "Could not save the trust level")
    }
  }

  const current = TRUST_LEVELS.find((o) => o.value === trust) ?? TRUST_LEVELS[1]
  return (
    <Select value={trust} onValueChange={(v) => void change(v)}>
      <SelectTrigger className="h-7 w-28 text-xs" aria-label={`Trust level for ${server}. ${current.hint}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TRUST_LEVELS.map((o) => (
          <SelectItem key={o.value} value={o.value} title={o.hint}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
