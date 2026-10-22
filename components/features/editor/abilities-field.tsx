"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, FilePen, Loader2, Lock, Server, SlidersHorizontal, Terminal, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { apiFetch } from "@/lib/api"
import {
  ABILITY_LEVEL_ORDER,
  ABILITY_LEVELS,
  abilityChoiceOf,
  includedTools,
  riskOfTools,
  toggleTool,
  type AbilityChoice,
  type AbilityRisk,
} from "@/lib/artifacts/abilities"
import {
  BUILTIN_TOOL_LABELS,
  BUILTIN_TOOL_NAMES,
  expandBuiltinTools,
  type BuiltinToolName,
} from "@/lib/runtime/tool-names"
import type { McpServerStatus } from "@/lib/mcp/types"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export const CHOICE_ICONS: Record<AbilityChoice, LucideIcon> = {
  read: Eye,
  write: FilePen,
  full: Terminal,
  custom: SlidersHorizontal,
}

export const RISK_DOT: Record<AbilityRisk, string> = {
  low: "bg-skill",
  medium: "bg-amber-500",
  high: "bg-destructive",
}

export const RISK_TEXT: Record<AbilityRisk, string> = {
  low: "Safe: it can only look.",
  medium: "Changes files: writes ask you first unless you allow them.",
  high: "Runs commands: every command asks you first.",
}

interface ChoiceCard {
  value: AbilityChoice
  label: string
  summary: string
  risk?: AbilityRisk
}

const CHOICES: ChoiceCard[] = [
  ...ABILITY_LEVEL_ORDER.map((level) => ({
    value: level,
    label: ABILITY_LEVELS[level].label,
    summary: ABILITY_LEVELS[level].summary,
    risk: ABILITY_LEVELS[level].risk,
  })),
  { value: "custom", label: "Custom", summary: "Pick each tool yourself, including browser flows." },
]

/** Agent abilities: a level (or custom tools) plus which MCP servers it may use. */
export function AbilitiesField({
  tools,
  mcpServers,
  onToolsChange,
  onMcpServersChange,
}: {
  tools: BuiltinToolName[]
  mcpServers: string[]
  onToolsChange: (tools: BuiltinToolName[]) => void
  onMcpServersChange: (servers: string[]) => void
}): React.ReactElement {
  const derived = abilityChoiceOf(tools)
  const [customOpen, setCustomOpen] = React.useState(derived === "custom")
  const choice: AbilityChoice = customOpen ? "custom" : derived
  const included = includedTools(tools)
  const risk = riskOfTools(expandBuiltinTools(tools))

  function pick(next: AbilityChoice): void {
    if (next === "custom") {
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    onToolsChange([...ABILITY_LEVELS[next].tools])
  }

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Abilities" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {CHOICES.map((card) => {
          const Icon = CHOICE_ICONS[card.value]
          const selected = choice === card.value
          return (
            <button
              key={card.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(card.value)}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {card.label}
                {card.risk ? (
                  <span aria-hidden className={cn("ml-auto h-2 w-2 rounded-full", RISK_DOT[card.risk])} />
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">{card.summary}</span>
            </button>
          )
        })}
      </div>

      {choice === "custom" ? (
        <div className="grid gap-x-6 gap-y-3 rounded-lg border p-3 sm:grid-cols-2">
          {BUILTIN_TOOL_NAMES.map((name) => {
            const id = `tool-${name}`
            const isIncluded = included.includes(name)
            return (
              <div key={name} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <Label htmlFor={id} className="text-sm">
                    {BUILTIN_TOOL_LABELS[name].label}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    {isIncluded ? "Included with the tools above" : BUILTIN_TOOL_LABELS[name].hint}
                  </p>
                </div>
                <Switch
                  id={id}
                  checked={tools.includes(name) || isIncluded}
                  disabled={isIncluded}
                  onCheckedChange={(on) => onToolsChange(toggleTool(tools, name, on))}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Tools it gets</p>
          <ul aria-label="Tools it gets" className="flex flex-wrap gap-1.5">
            {expandBuiltinTools(tools).map((name) => (
              <li key={name}>
                <Badge variant="secondary" className="gap-1 font-normal">
                  {included.includes(name) ? <Lock className="h-3 w-3" aria-hidden /> : null}
                  {BUILTIN_TOOL_LABELS[name].label}
                  {included.includes(name) ? <span className="sr-only">(included)</span> : null}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", RISK_DOT[risk])} />
        {tools.length === 0 ? "No built-in tools: it can only talk." : RISK_TEXT[risk]}
      </p>

      <McpServerPicker value={mcpServers} onChange={onMcpServersChange} />
    </div>
  )
}

type ServersState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; names: string[] }

export function McpServerPicker({
  value,
  onChange,
  showAll = true,
  heading = true,
}: {
  value: string[]
  onChange: (servers: string[]) => void
  /** An empty list means every server. Turn this off when empty means none. */
  showAll?: boolean
  heading?: boolean
}): React.ReactElement {
  const [state, setState] = React.useState<ServersState>({ status: "loading" })

  React.useEffect(() => {
    let active = true
    apiFetch<{ servers: McpServerStatus[] }>("/api/mcp")
      .then((data) => active && setState({ status: "ready", names: data.servers.map((s) => s.name) }))
      .catch(() => active && setState({ status: "error" }))
    return () => {
      active = false
    }
  }, [])

  const known = state.status === "ready" ? state.names : []
  const missing = value.filter((name) => !known.includes(name))
  const all = value.length === 0

  function toggle(name: string): void {
    if (value.includes(name)) onChange(value.filter((s) => s !== name))
    else onChange([...value, name])
  }

  return (
    <div className="space-y-2">
      {heading ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Server className="h-3.5 w-3.5" aria-hidden />
          MCP servers
        </p>
      ) : null}
      {state.status === "loading" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading servers…
        </p>
      ) : (
        <div role="group" aria-label="MCP servers" className="flex flex-wrap gap-1.5">
          {showAll ? <ServerChip label="All servers" pressed={all} onClick={() => onChange([])} /> : null}
          {known.map((name) => (
            <ServerChip key={name} label={name} pressed={value.includes(name)} onClick={() => toggle(name)} />
          ))}
          {state.status === "ready"
            ? missing.map((name) => (
                <ServerChip
                  key={name}
                  label={`${name} (not found)`}
                  pressed
                  warn
                  onClick={() => toggle(name)}
                />
              ))
            : null}
        </div>
      )}
      {state.status === "error" ? (
        <p className="text-xs text-destructive">Could not load MCP servers. The saved choice is kept.</p>
      ) : state.status === "ready" && known.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No MCP servers in this workspace.{" "}
          <Link href="/settings/mcp" className="underline underline-offset-2">
            Add one
          </Link>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {showAll && all
            ? "It can use every server in this workspace."
            : value.length === 0
              ? "Pick at least one server."
              : "It can use only the selected servers."}
        </p>
      )}
    </div>
  )
}

function ServerChip({
  label,
  pressed,
  warn = false,
  onClick,
}: {
  label: string
  pressed: boolean
  warn?: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed
          ? warn
            ? "border-amber-500/60 bg-amber-500/10 text-foreground"
            : "border-primary bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  )
}
