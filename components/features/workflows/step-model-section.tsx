"use client"

import * as React from "react"

import { isProviderId } from "@/lib/llm/model-ref"
import { ModelChoiceFields } from "@/components/features/models/model-choice-fields"
import {
  isTaskSelectValue,
  type ModelSelectValue,
  type TaskChoiceMap,
} from "@/components/features/models/model-choice"
import { Button } from "@/components/ui/button"

/** Collapsed per-step model override. Closed by default. */
export function StepModelSection({
  stepKey,
  modelChoice,
  model,
  summary,
  taskChoices,
  onChange,
}: {
  stepKey: string
  modelChoice: ModelSelectValue
  model: string
  summary: string
  taskChoices: TaskChoiceMap
  onChange: (patch: { modelChoice: ModelSelectValue; model: string }) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const panelId = `${stepKey}-model-panel`

  function changeChoice(next: ModelSelectValue): void {
    if (next === "inherit" || isTaskSelectValue(next)) {
      onChange({ modelChoice: next, model: "" })
      return
    }
    if (isProviderId(next)) onChange({ modelChoice: next, model })
  }

  return (
    <div className="space-y-3 sm:col-span-2">
      <Button
        type="button"
        variant="outline"
        className="h-auto w-full justify-start px-3 py-2 text-left font-normal"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-sm">
          <span className="font-medium">Model:</span>{" "}
          <span className="text-muted-foreground">{summary}</span>
        </span>
      </Button>
      {open ? (
        <div id={panelId} className="rounded-md border px-3 py-3">
          <ModelChoiceFields
            idPrefix={`${stepKey}-model`}
            selectLabel="Model provider"
            modelLabel="Step model"
            value={modelChoice}
            model={model}
            onValueChange={changeChoice}
            onModelChange={(next) => onChange({ modelChoice, model: next })}
            taskChoices={taskChoices}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Leave this on Inherit to use the agent, then the workflow.
          </p>
        </div>
      ) : null}
    </div>
  )
}
