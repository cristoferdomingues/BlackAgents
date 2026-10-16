"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, ChevronRight, FolderOpen, KeyRound, ListChecks, Trash2, Wrench, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { Artifact } from "@/lib/artifacts/types"
import type { WorkspaceFile } from "@/lib/files/schema"
import type { BuiltinToolName } from "@/lib/runtime/tool-names"
import { MAX_STEP_FILES, MAX_STEP_TURNS, DEFAULT_STEP_TURNS, type WorkflowStep } from "@/lib/workflows/schema"
import {
  agentBuiltinTools,
  inputForKind,
  STEP_INPUT_ORDER,
  STEP_INPUTS,
  STEP_KIND_ORDER,
  STEP_KINDS,
  stepAbility,
  stepFacts,
  stepKindFlags,
  stepKindOf,
  type StepKind,
} from "@/lib/workflows/step-explain"
import type { ModelSelectValue, TaskChoiceMap } from "@/components/features/models/model-choice"
import { RISK_DOT } from "@/components/features/editor/abilities-field"
import { FilePickerDialog, WorkspaceFileChip } from "@/components/features/files/file-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

import { StepAbilitiesField } from "./step-abilities-field"
import { StepModelSection } from "./step-model-section"

export interface StepDraft {
  key: string
  id: string
  agent: string
  instructions: string
  input: WorkflowStep["input"]
  files: string[]
  ownTools: boolean
  tools: BuiltinToolName[]
  mcpServers?: string[]
  allowWrites: boolean
  maxTurns: number
  gate: boolean
  review: boolean
  login: boolean
  username: string
  password: string
  modelChoice: ModelSelectValue
  model: string
}

const KIND_ICONS: Record<StepKind, LucideIcon> = {
  work: Wrench,
  review: ListChecks,
  login: KeyRound,
}

function numberValue(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? fallback : n
}

/** One workflow step: a one-line summary that opens into the full form. */
export function StepCard({
  step,
  index,
  total,
  open,
  agents,
  workspaceFiles,
  modelSummary,
  taskChoices,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onFilesUpdated,
}: {
  step: StepDraft
  index: number
  total: number
  open: boolean
  agents: Artifact[]
  workspaceFiles: WorkspaceFile[]
  modelSummary: string
  taskChoices: TaskChoiceMap
  onToggle: () => void
  onChange: (patch: Partial<StepDraft>) => void
  onMove: (delta: number) => void
  onRemove: () => void
  onFilesUpdated: (files: WorkspaceFile[]) => void
}): React.ReactElement {
  const number = index + 1
  const bodyId = `${step.key}-body`
  const agent = agents.find((a) => a.name === step.agent)
  const agentTools = agent ? agentBuiltinTools(agent.frontmatter) : null
  const kind = stepKindOf(step)
  const ability = stepAbility({ ownTools: step.ownTools, tools: step.tools, agentTools })
  const facts = stepFacts({
    kind,
    ability,
    gate: step.gate,
    allowWrites: step.allowWrites,
    files: step.files.length,
  })

  function pickKind(next: StepKind): void {
    onChange({ ...stepKindFlags(next), input: inputForKind(next, step.input) })
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`Step ${number}: ${step.id || "no id"}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
              <span className="truncate font-medium">{step.id || `Step ${number}`}</span>
              <span className={cn("truncate", step.agent ? "text-muted-foreground" : "text-destructive")}>
                · {step.agent || "No agent yet"}
              </span>
            </span>
            {facts.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {facts.map((fact) => (
                  <Badge key={fact} variant="secondary" className="gap-1 px-1.5 py-0 text-[11px] font-normal">
                    {ability && fact === ability.label ? (
                      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", RISK_DOT[ability.risk])} />
                    ) : null}
                    {fact}
                  </Badge>
                ))}
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="icon" aria-label={`Move step ${number} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Move step ${number} down`} disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Remove step ${number}`} disabled={total === 1} onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {open ? (
        <div id={bodyId} className="space-y-6 border-t p-4">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Task</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${step.key}-agent`}>Agent</Label>
                <Select value={step.agent} onValueChange={(v) => onChange({ agent: v })}>
                  <SelectTrigger id={`${step.key}-agent`}>
                    <SelectValue placeholder="Choose an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.name} value={a.name}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {agent?.description || "The agent that does this step."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${step.key}-id`}>Step id</Label>
                <Input
                  id={`${step.key}-id`}
                  value={step.id}
                  onChange={(e) => onChange({ id: e.target.value.toLowerCase().replace(/[\s_]+/g, "-") })}
                />
                <p className="text-xs text-muted-foreground">A short name for run logs, like plan or review.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label id={`${step.key}-kind-label`}>Step type</Label>
              <div role="radiogroup" aria-labelledby={`${step.key}-kind-label`} className="grid gap-2 sm:grid-cols-3">
                {STEP_KIND_ORDER.map((value) => {
                  const Icon = KIND_ICONS[value]
                  const selected = kind === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => pickKind(value)}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {STEP_KINDS[value].label}
                      </span>
                      <span className="text-xs text-muted-foreground">{STEP_KINDS[value].summary}</span>
                    </button>
                  )
                })}
              </div>
              {step.login && step.review ? (
                <p className="text-xs text-muted-foreground">This step also reviews earlier work.</p>
              ) : null}
            </div>

            {kind === "login" ? (
              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${step.key}-username`}>Username</Label>
                  <Input
                    id={`${step.key}-username`}
                    autoComplete="off"
                    value={step.username}
                    placeholder="Saved separately from the workflow"
                    onChange={(e) => onChange({ username: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${step.key}-password`}>Password</Label>
                  <Input
                    id={`${step.key}-password`}
                    type="password"
                    autoComplete="new-password"
                    value={step.password}
                    placeholder="Not stored in the workflow file"
                    onChange={(e) => onChange({ password: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Leave these empty to be asked when the step runs. A saved password stays in secrets, not in the workflow.
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor={`${step.key}-instructions`}>Instructions for this step</Label>
              <Textarea
                id={`${step.key}-instructions`}
                rows={3}
                value={step.instructions}
                placeholder={STEP_KINDS[kind].placeholder}
                onChange={(e) => onChange({ instructions: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              {index === 0 ? (
                <>
                  <p className="text-sm font-medium">What this step gets</p>
                  <p className="text-sm text-muted-foreground">The first step gets the task.</p>
                </>
              ) : (
                <>
                  <Label htmlFor={`${step.key}-input`}>What this step gets</Label>
                  <Select
                    value={step.input}
                    onValueChange={(v) => onChange({ input: STEP_INPUT_ORDER.find((item) => item === v) ?? "previous" })}
                  >
                    <SelectTrigger id={`${step.key}-input`} className="sm:max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STEP_INPUT_ORDER.map((value) => (
                        <SelectItem key={value} value={value}>
                          {STEP_INPUTS[value].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{STEP_INPUTS[step.input].summary}</p>
                </>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Label>Files for this step</Label>
                  <p className="text-xs text-muted-foreground">
                    The agent gets each file&apos;s disk path, so it can read it or upload it in a browser form.
                  </p>
                </div>
                <FilePickerDialog
                  selectedNames={step.files}
                  multiSelect
                  disabled={step.files.length >= MAX_STEP_FILES}
                  onFilesUpdated={onFilesUpdated}
                  onPick={(picked) => {
                    const exists = step.files.includes(picked.name)
                    const next = exists
                      ? step.files.filter((f) => f !== picked.name)
                      : step.files.length < MAX_STEP_FILES
                        ? [...step.files, picked.name]
                        : step.files
                    onChange({ files: next })
                  }}
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      <FolderOpen className="h-4 w-4" />
                      Select or upload files
                    </Button>
                  }
                />
              </div>
              {step.files.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label={`Files for step ${number}`}>
                  {step.files.map((fileName) => {
                    const meta = workspaceFiles.find((f) => f.name === fileName)
                    return (
                      <li key={fileName}>
                        <WorkspaceFileChip
                          name={fileName}
                          originalName={meta?.originalName}
                          kind={meta?.kind}
                          onRemove={() => onChange({ files: step.files.filter((f) => f !== fileName) })}
                        />
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abilities and checks</h3>
            <StepAbilitiesField
              stepKey={step.key}
              ownTools={step.ownTools}
              tools={step.tools}
              agentTools={agentTools}
              onChange={onChange}
            />
            {ability?.canWrite ? (
              <SwitchRow
                id={`${step.key}-writes`}
                label="Allow file writes without asking"
                hint="Off: you approve each file change. Commands always ask."
                checked={step.allowWrites}
                onChange={(v) => onChange({ allowWrites: v })}
              />
            ) : null}
            <SwitchRow
              id={`${step.key}-gate`}
              label="Jev checks the result"
              hint="Jev, the built-in checker, reads the result and decides: go on, try this step again, or stop."
              checked={step.gate}
              onChange={(v) => onChange({ gate: v })}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`${step.key}-turns`}>Tool-call limit (1–{MAX_STEP_TURNS})</Label>
              <Input
                id={`${step.key}-turns`}
                type="number"
                min={1}
                max={MAX_STEP_TURNS}
                className="sm:max-w-32"
                value={step.maxTurns}
                onChange={(e) => onChange({ maxTurns: numberValue(e.target.value, step.maxTurns) })}
              />
              <p className="text-xs text-muted-foreground">
                How many times the agent may use a tool before it must answer. Default {DEFAULT_STEP_TURNS}.
              </p>
            </div>
            <StepModelSection
              stepKey={step.key}
              modelChoice={step.modelChoice}
              model={step.model}
              summary={modelSummary}
              taskChoices={taskChoices}
              onChange={onChange}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}
