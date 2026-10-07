"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Loader2, Play, Plus, Save, Trash2, Workflow as WorkflowIcon } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { ProviderId } from "@/lib/llm/types"
import { BUILTIN_TOOL_LABELS, BUILTIN_TOOL_NAMES, DEFAULT_AGENT_TOOLS, type BuiltinToolName } from "@/lib/runtime/tool-names"
import {
  MAX_GATE_RETRIES,
  MAX_STEP_TURNS,
  MAX_WORKFLOW_STEPS,
  workflowSchema,
  type RunSummary,
  type Workflow,
  type WorkflowRun,
  type WorkflowStep,
} from "@/lib/workflows/schema"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

import { formatTime, RunStatusBadge } from "./run-status"

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "custom", label: "Custom" },
]

interface StepDraft {
  key: string
  id: string
  agent: string
  instructions: string
  input: WorkflowStep["input"]
  ownTools: boolean
  tools: BuiltinToolName[]
  mcpServers?: string[]
  allowWrites: boolean
  maxTurns: number
  gate: boolean
}

interface Draft {
  name: string
  description: string
  task: string
  provider: ProviderId | "default"
  model: string
  triggerType: Workflow["trigger"]["type"]
  everyMinutes: number
  at: string
  stepTimeoutMinutes: number
  runTimeoutMinutes: number
  maxRetries: number
  selfAssess: boolean
  steps: StepDraft[]
}

let keySeq = 0
const nextKey = (): string => `step-${++keySeq}`

function emptyStep(index: number, agent = "", key = nextKey()): StepDraft {
  return {
    key,
    id: `step-${index + 1}`,
    agent,
    instructions: "",
    input: "previous",
    ownTools: true,
    tools: [...DEFAULT_AGENT_TOOLS],
    allowWrites: false,
    maxTurns: 6,
    gate: false,
  }
}

function toDraft(wf: Workflow): Draft {
  return {
    name: wf.name,
    description: wf.description,
    task: wf.task,
    provider: wf.provider ?? "default",
    model: wf.model ?? "",
    triggerType: wf.trigger.type,
    everyMinutes: wf.trigger.type === "interval" ? wf.trigger.everyMinutes : 60,
    at: wf.trigger.type === "daily" ? wf.trigger.at : "09:00",
    stepTimeoutMinutes: wf.limits.stepTimeoutMinutes,
    runTimeoutMinutes: wf.limits.runTimeoutMinutes,
    maxRetries: wf.limits.maxRetries,
    selfAssess: wf.selfAssess,
    steps: wf.steps.map((s) => ({
      key: nextKey(),
      id: s.id,
      agent: s.agent,
      instructions: s.instructions,
      input: s.input,
      ownTools: !s.tools,
      tools: s.tools ?? [...DEFAULT_AGENT_TOOLS],
      mcpServers: s.mcpServers,
      allowWrites: s.allowWrites,
      maxTurns: s.maxTurns,
      gate: s.gate,
    })),
  }
}

function toInput(d: Draft): unknown {
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    task: d.task,
    provider: d.provider === "default" ? undefined : d.provider,
    model: d.model.trim() || undefined,
    trigger:
      d.triggerType === "interval"
        ? { type: "interval", everyMinutes: d.everyMinutes }
        : d.triggerType === "daily"
          ? { type: "daily", at: d.at }
          : { type: "manual" },
    limits: {
      stepTimeoutMinutes: d.stepTimeoutMinutes,
      runTimeoutMinutes: d.runTimeoutMinutes,
      maxRetries: d.maxRetries,
    },
    selfAssess: d.selfAssess,
    steps: d.steps.map((s) => ({
      id: s.id.trim(),
      agent: s.agent,
      instructions: s.instructions,
      input: s.input,
      tools: s.ownTools ? undefined : s.tools,
      mcpServers: s.mcpServers,
      allowWrites: s.allowWrites,
      maxTurns: s.maxTurns,
      gate: s.gate,
    })),
  }
}

function numberValue(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? fallback : n
}

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" }

export function WorkflowBuilder({ name }: { name?: string }) {
  const router = useRouter()
  const { workspace, loading, byType } = useWorkspace()
  const agents = byType("agent")
  const editing = Boolean(name)
  const [load, setLoad] = React.useState<LoadState>(editing ? { kind: "loading" } : { kind: "ready" })
  const [draft, setDraft] = React.useState<Draft>(() => ({
    name: "",
    description: "",
    task: "",
    provider: "default",
    model: "",
    triggerType: "manual",
    everyMinutes: 60,
    at: "09:00",
    stepTimeoutMinutes: 10,
    runTimeoutMinutes: 60,
    maxRetries: 1,
    selfAssess: false,
    steps: [emptyStep(0, "", "step-initial")],
  }))
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!name || !workspace) return
    apiFetch<{ workflow: Workflow }>(`/api/workflows/${encodeURIComponent(name)}`)
      .then(({ workflow }) => {
        setDraft(toDraft(workflow))
        setLoad({ kind: "ready" })
      })
      .catch((err: unknown) =>
        setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load the workflow" })
      )
  }, [name, workspace])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }))
  const setStep = (key: string, patch: Partial<StepDraft>): void =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }))
  const moveStep = (index: number, delta: number): void =>
    setDraft((d) => {
      const steps = [...d.steps]
      const [step] = steps.splice(index, 1)
      steps.splice(index + delta, 0, step)
      return { ...d, steps }
    })

  async function save() {
    const parsed = workflowSchema.safeParse(toInput(draft))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setError(`${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "Invalid workflow"}`)
      return
    }
    setError(null)
    setSaving(true)
    try {
      if (editing && name) {
        await apiFetch(`/api/workflows/${encodeURIComponent(name)}`, {
          method: "PUT",
          body: JSON.stringify(parsed.data),
        })
        toast.success("Workflow saved")
      } else {
        await apiFetch("/api/workflows", { method: "POST", body: JSON.stringify(parsed.data) })
        toast.success("Workflow created")
        router.push(`/workflows/${parsed.data.name}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the workflow")
    } finally {
      setSaving(false)
    }
  }

  if (!workspace && !loading) return <NoWorkspace message="Select a workspace to build agent workflows." />
  if (load.kind === "loading") {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading workflow" />
      </div>
    )
  }
  if (load.kind === "error") {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-destructive">{load.message}</p>
        <Button asChild variant="outline">
          <Link href="/workflows">Back to workflows</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <WorkflowIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{editing ? name : "New workflow"}</h1>
            <p className="text-sm text-muted-foreground">Each step runs one agent and hands its result to the next.</p>
          </div>
        </div>
        <div className="flex gap-2">
          {editing && name ? <DeleteButton name={name} /> : null}
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">Name</Label>
            <Input
              id="wf-name"
              value={draft.name}
              disabled={editing}
              placeholder="review-and-fix"
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-description">Description</Label>
            <Input id="wf-description" value={draft.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wf-task">Default task</Label>
            <Textarea
              id="wf-task"
              rows={3}
              value={draft.task}
              placeholder="What should the team do? Scheduled runs use this text."
              onChange={(e) => set("task", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-provider">AI provider</Label>
            <Select value={draft.provider} onValueChange={(v) => set("provider", v === "default" ? "default" : (PROVIDERS.find((p) => p.id === v)?.id ?? "default"))}>
              <SelectTrigger id="wf-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Assistant default</SelectItem>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-model">Model</Label>
            <Input id="wf-model" value={draft.model} placeholder="Provider default" onChange={(e) => set("model", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <section aria-label="Steps" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Steps</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={draft.steps.length >= MAX_WORKFLOW_STEPS}
            onClick={() => set("steps", [...draft.steps, emptyStep(draft.steps.length, agents[0]?.name)])}
          >
            <Plus className="h-4 w-4" />
            Add step
          </Button>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This workspace has no agents yet. <Link className="underline" href="/agents/new">Create an agent</Link> first.
          </p>
        ) : null}
        {draft.steps.map((step, index) => (
          <Card key={step.key}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="text-sm">Step {index + 1}</CardTitle>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => moveStep(index, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Move step ${index + 1} down`} disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove step ${index + 1}`}
                  disabled={draft.steps.length === 1}
                  onClick={() => set("steps", draft.steps.filter((s) => s.key !== step.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${step.key}-id`}>Step id</Label>
                <Input id={`${step.key}-id`} value={step.id} onChange={(e) => setStep(step.key, { id: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${step.key}-agent`}>Agent</Label>
                <Select value={step.agent} onValueChange={(v) => setStep(step.key, { agent: v })}>
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
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${step.key}-instructions`}>Instructions for this step</Label>
                <Textarea
                  id={`${step.key}-instructions`}
                  rows={3}
                  value={step.instructions}
                  onChange={(e) => setStep(step.key, { instructions: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${step.key}-input`}>Input</Label>
                <Select
                  value={step.input}
                  onValueChange={(v) => setStep(step.key, { input: v === "task" ? "task" : v === "all" ? "all" : "previous" })}
                >
                  <SelectTrigger id={`${step.key}-input`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="previous">Previous step output</SelectItem>
                    <SelectItem value="all">All earlier outputs</SelectItem>
                    <SelectItem value="task">Only the task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${step.key}-turns`}>Tool-call limit (1–{MAX_STEP_TURNS})</Label>
                <Input
                  id={`${step.key}-turns`}
                  type="number"
                  min={1}
                  max={MAX_STEP_TURNS}
                  value={step.maxTurns}
                  onChange={(e) => setStep(step.key, { maxTurns: numberValue(e.target.value, step.maxTurns) })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`${step.key}-own-tools`}
                    checked={step.ownTools}
                    onCheckedChange={(v) => setStep(step.key, { ownTools: v })}
                  />
                  <Label htmlFor={`${step.key}-own-tools`}>Use the agent&apos;s own tools</Label>
                </div>
                {!step.ownTools ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {BUILTIN_TOOL_NAMES.map((tool) => (
                      <div key={tool} className="flex items-center gap-2">
                        <Switch
                          id={`${step.key}-tool-${tool}`}
                          checked={step.tools.includes(tool)}
                          onCheckedChange={(v) =>
                            setStep(step.key, {
                              tools: v ? [...step.tools, tool] : step.tools.filter((t) => t !== tool),
                            })
                          }
                        />
                        <Label htmlFor={`${step.key}-tool-${tool}`} className="font-normal">
                          {BUILTIN_TOOL_LABELS[tool].label}
                        </Label>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={`${step.key}-writes`}
                  checked={step.allowWrites}
                  onCheckedChange={(v) => setStep(step.key, { allowWrites: v })}
                />
                <Label htmlFor={`${step.key}-writes`}>Allow file writes without asking</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id={`${step.key}-gate`} checked={step.gate} onCheckedChange={(v) => setStep(step.key, { gate: v })} />
                <Label htmlFor={`${step.key}-gate`}>Jev checks the result</Label>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trigger and limits</CardTitle>
          <CardDescription>Scheduled runs only start while BlackAgents is open.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="wf-trigger">Trigger</Label>
            <Select
              value={draft.triggerType}
              onValueChange={(v) => set("triggerType", v === "interval" ? "interval" : v === "daily" ? "daily" : "manual")}
            >
              <SelectTrigger id="wf-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="interval">Every N minutes</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.triggerType === "interval" ? (
            <div className="space-y-1.5">
              <Label htmlFor="wf-every">Minutes (5–1440)</Label>
              <Input
                id="wf-every"
                type="number"
                min={5}
                max={1440}
                value={draft.everyMinutes}
                onChange={(e) => set("everyMinutes", numberValue(e.target.value, draft.everyMinutes))}
              />
            </div>
          ) : null}
          {draft.triggerType === "daily" ? (
            <div className="space-y-1.5">
              <Label htmlFor="wf-at">Time (HH:MM)</Label>
              <Input id="wf-at" type="time" value={draft.at} onChange={(e) => set("at", e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="wf-step-timeout">Step time limit (min)</Label>
            <Input
              id="wf-step-timeout"
              type="number"
              min={1}
              max={30}
              value={draft.stepTimeoutMinutes}
              onChange={(e) => set("stepTimeoutMinutes", numberValue(e.target.value, draft.stepTimeoutMinutes))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-run-timeout">Run time limit (min)</Label>
            <Input
              id="wf-run-timeout"
              type="number"
              min={1}
              max={180}
              value={draft.runTimeoutMinutes}
              onChange={(e) => set("runTimeoutMinutes", numberValue(e.target.value, draft.runTimeoutMinutes))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-retries">Retries when Jev says retry (0–{MAX_GATE_RETRIES})</Label>
            <Input
              id="wf-retries"
              type="number"
              min={0}
              max={MAX_GATE_RETRIES}
              value={draft.maxRetries}
              onChange={(e) => set("maxRetries", numberValue(e.target.value, draft.maxRetries))}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-3">
            <Switch id="wf-self-assess" checked={draft.selfAssess} onCheckedChange={(v) => set("selfAssess", v)} />
            <Label htmlFor="wf-self-assess">After each run, agents reflect and send learnings to the Brain inbox</Label>
          </div>
        </CardContent>
      </Card>

      {editing && name ? <RunPanel name={name} defaultTask={draft.task} /> : null}
    </div>
  )
}

function DeleteButton({ name }: { name: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function remove() {
    setBusy(true)
    try {
      await apiFetch(`/api/workflows/${encodeURIComponent(name)}`, { method: "DELETE" })
      toast.success("Workflow deleted")
      router.push("/workflows")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the workflow")
      setBusy(false)
    }
  }

  return confirming ? (
    <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      Confirm delete
    </Button>
  ) : (
    <Button variant="outline" onClick={() => setConfirming(true)}>
      <Trash2 className="h-4 w-4" />
      Delete
    </Button>
  )
}

function RunPanel({ name, defaultTask }: { name: string; defaultTask: string }) {
  const router = useRouter()
  const [task, setTask] = React.useState("")
  const [runs, setRuns] = React.useState<RunSummary[] | null>(null)
  const [starting, setStarting] = React.useState(false)

  React.useEffect(() => {
    apiFetch<{ runs: RunSummary[] }>(`/api/workflows/${encodeURIComponent(name)}/runs`)
      .then((data) => setRuns(data.runs))
      .catch(() => setRuns([]))
  }, [name])

  async function start() {
    setStarting(true)
    try {
      const { run } = await apiFetch<{ run: WorkflowRun }>(`/api/workflows/${encodeURIComponent(name)}/runs`, {
        method: "POST",
        body: JSON.stringify({ task: task.trim() || undefined }),
      })
      router.push(`/workflows/runs/${run.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the run")
      setStarting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run</CardTitle>
        <CardDescription>Save your changes first. The run uses the saved workflow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="run-task">Task for this run</Label>
          <Textarea
            id="run-task"
            rows={2}
            value={task}
            placeholder={defaultTask || "Leave empty to use the default task"}
            onChange={(e) => setTask(e.target.value)}
          />
        </div>
        <Button onClick={() => void start()} disabled={starting}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run now
        </Button>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">History</h3>
          {runs === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading runs" />
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {runs.slice(0, 10).map((run) => (
                <li key={run.id}>
                  <Link href={`/workflows/runs/${run.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                    <span className="flex items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <span className="text-muted-foreground">{run.trigger === "schedule" ? "Scheduled" : "Manual"}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{formatTime(run.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
