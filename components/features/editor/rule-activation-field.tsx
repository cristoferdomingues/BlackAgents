"use client"

import * as React from "react"
import { FileCode2, Hand, Infinity as InfinityIcon, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ruleActivationOf, ruleFieldsFor, type RuleActivation } from "@/lib/artifacts/editor-helpers"
import { GlobsInput } from "@/components/features/editor/globs-input"

const OPTIONS: Array<{ value: RuleActivation; label: string; summary: string; icon: LucideIcon }> = [
  { value: "always", label: "Always", summary: "Added to every request.", icon: InfinityIcon },
  { value: "files", label: "For some files", summary: "When matching files are edited.", icon: FileCode2 },
  { value: "request", label: "On request", summary: "Only when you or the assistant ask for it.", icon: Hand },
]

/** When a rule is used, as one choice instead of a switch plus globs. */
export function RuleActivationField({
  alwaysApply,
  globs,
  onChange,
}: {
  alwaysApply: boolean
  globs: string[]
  onChange: (next: { alwaysApply: boolean; globs: string[] }) => void
}): React.ReactElement {
  const derived = ruleActivationOf(alwaysApply, globs)
  // "For some files" with no globs yet looks like "On request"; keep the user's pick.
  const [filesPicked, setFilesPicked] = React.useState(false)
  const activation: RuleActivation = derived === "request" && filesPicked ? "files" : derived

  function pick(next: RuleActivation): void {
    setFilesPicked(next === "files")
    onChange(ruleFieldsFor(next, globs))
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="When does it apply?" className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((option) => {
          const Icon = option.icon
          const selected = activation === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(option.value)}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground">{option.summary}</span>
            </button>
          )
        })}
      </div>
      {activation === "files" ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">File patterns</p>
          <GlobsInput value={globs} onChange={(next) => onChange({ alwaysApply: false, globs: next })} />
          {globs.length === 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Add at least one pattern, or the rule only runs on request.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
