"use client"

import * as React from "react"
import { Bot } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  ABILITY_LEVEL_ORDER,
  ABILITY_LEVELS,
  abilityChoiceOf,
  includedTools,
  riskOfTools,
  toggleTool,
  type AbilityChoice,
} from "@/lib/artifacts/abilities"
import { BUILTIN_TOOL_LABELS, BUILTIN_TOOL_NAMES, expandBuiltinTools, type BuiltinToolName } from "@/lib/runtime/tool-names"
import { abilityLabel } from "@/lib/workflows/step-explain"
import { CHOICE_ICONS, RISK_DOT, RISK_TEXT } from "@/components/features/editor/abilities-field"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

type StepChoice = "agent" | AbilityChoice

/** What one step may do: the agent's own tools, a level, or custom tools. */
export function StepAbilitiesField({
  stepKey,
  ownTools,
  tools,
  agentTools,
  onChange,
}: {
  stepKey: string
  ownTools: boolean
  tools: BuiltinToolName[]
  /** `null` while no agent is chosen. */
  agentTools: BuiltinToolName[] | null
  onChange: (patch: { ownTools: boolean; tools: BuiltinToolName[] }) => void
}): React.ReactElement {
  const derived: StepChoice = ownTools ? "agent" : abilityChoiceOf(tools)
  const [customOpen, setCustomOpen] = React.useState(derived === "custom")
  const choice: StepChoice = ownTools ? "agent" : customOpen ? "custom" : derived
  const effective = ownTools ? agentTools : tools
  const included = includedTools(tools)

  function pick(next: StepChoice): void {
    setCustomOpen(next === "custom")
    if (next === "agent") onChange({ ownTools: true, tools })
    else if (next === "custom") onChange({ ownTools: false, tools: ownTools ? [...(agentTools ?? tools)] : tools })
    else onChange({ ownTools: false, tools: [...ABILITY_LEVELS[next].tools] })
  }

  const options: Array<{ value: StepChoice; label: string }> = [
    { value: "agent", label: "Same as agent" },
    ...ABILITY_LEVEL_ORDER.map((level) => ({ value: level, label: ABILITY_LEVELS[level].label })),
    { value: "custom", label: "Custom" },
  ]

  const summary =
    choice === "agent"
      ? agentTools
        ? `Uses the tools in the agent file: ${abilityLabel(agentTools)}.`
        : "Choose an agent to see its tools."
      : choice === "custom"
        ? "Pick each tool yourself, including browser flows."
        : ABILITY_LEVELS[choice].summary
  const risk = effective ? riskOfTools(expandBuiltinTools(effective)) : null

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="What this step can do" className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const Icon = option.value === "agent" ? Bot : CHOICE_ICONS[option.value]
          const selected = choice === option.value
          const dot =
            option.value === "agent"
              ? agentTools
                ? riskOfTools(expandBuiltinTools(agentTools))
                : null
              : option.value === "custom"
                ? null
                : ABILITY_LEVELS[option.value].risk
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(option.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {option.label}
              {dot ? <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", RISK_DOT[dot])} /> : null}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{summary}</p>

      {choice === "custom" ? (
        <div className="grid gap-x-6 gap-y-3 rounded-lg border p-3 sm:grid-cols-2">
          {BUILTIN_TOOL_NAMES.map((name) => {
            const id = `${stepKey}-tool-${name}`
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
                  onCheckedChange={(on) => onChange({ ownTools: false, tools: toggleTool(tools, name, on) })}
                />
              </div>
            )
          })}
        </div>
      ) : null}

      {risk && effective ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", RISK_DOT[risk])} />
          {effective.length === 0 ? "No built-in tools: it can only talk." : RISK_TEXT[risk]}
        </p>
      ) : null}
    </div>
  )
}
