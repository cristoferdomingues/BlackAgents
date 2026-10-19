"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FolderOpen, Loader2, Play, Plus, Save, Trash2, Workflow as WorkflowIcon } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { WorkspaceFile } from "@/lib/files/schema"
import type { ProviderId } from "@/lib/llm/types"
import { parseStoredWorkflowDraft, WORKFLOW_DRAFT_STORAGE_KEY } from "@/lib/llm/workflow-draft"
import { DEFAULT_AGENT_TOOLS } from "@/lib/runtime/tool-names"
import { loginSecretIds } from "@/lib/workflows/login"
import { stepIndexOfIssue, stepLinkText } from "@/lib/workflows/step-explain"
import {
  DEFAULT_RUN_TIMEOUT_MINUTES,
  DEFAULT_STEP_TIMEOUT_MINUTES,
  DEFAULT_STEP_TURNS,
  MAX_GATE_RETRIES,
  MAX_RUN_TIMEOUT_MINUTES,
  MAX_STEP_FILES,
  MAX_STEP_TIMEOUT_MINUTES,
  MAX_WORKFLOW_STEPS,
  workflowSchema,
  type RunSummary,
  type Workflow,
  type WorkflowRun,
} from "@/lib/workflows/schema"
import {
  effectiveModelText,
  isTaskSelectValue,
  modelFormFromFrontmatter,
  stepModelFields,
  stepModelIssue,
} from "@/components/features/models/model-choice"
import { useSavedTaskModels } from "@/components/features/models/model-choice-fields"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { FilePickerDialog, WorkspaceFileChip } from "@/components/features/files/file-picker"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

import { formatTime, RunStatusBadge } from "./run-status"
import { StepCard, type StepDraft } from "./step-card"

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "custom", label: "Custom" },
]

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

function freeStepId(steps: StepDraft[]): string {
  const taken = new Set(steps.map((s) => s.id.trim()))
  let n = steps.length + 1
  while (taken.has(`step-${n}`)) n++
  return `step-${n}`
}

function emptyStep(id: string, agent = "", key = nextKey()): StepDraft {
  return {
    key,
    id,
    agent,
    instructions: "",
    input: "previous",
    files: [],
    ownTools: true,
    tools: [...DEFAULT_AGENT_TOOLS],
    allowWrites: false,
    maxTurns: DEFAULT_STEP_TURNS,
    gate: false,
    review: false,
    repair: false,
    sendBack: false,
    sendBackStep: "",
    sendBackRounds: 2,
    login: false,
    username: "",
    password: "",
    modelChoice: "inherit",
    model: "",
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
    steps: wf.steps.map((s) => {
      const modelFields = modelFormFromFrontmatter(s.model, s.provider)
      return {
        key: nextKey(),
        id: s.id,
        agent: s.agent,
        instructions: s.instructions,
        input: s.input,
        files: s.files ?? [],
        ownTools: !s.tools,
        tools: s.tools ?? [...DEFAULT_AGENT_TOOLS],
        mcpServers: s.mcpServers,
        allowWrites: s.allowWrites,
        maxTurns: s.maxTurns,
        gate: s.gate,
        review: s.review,
        repair: s.repair,
        sendBack: Boolean(s.onReject),
        sendBackStep: s.onReject?.step ?? "",
        sendBackRounds: s.onReject?.maxRounds ?? 2,
        login: s.login,
        username: "",
        password: "",
        modelChoice: modelFields.modelChoice,
        model: modelFields.modelAlias || modelFields.modelId,
      }
    }),
  }
}

function toInput(d: Draft): { body: unknown; error: string | null; stepKey?: string } {
  const steps: unknown[] = []
  for (const s of d.steps) {
    const issue = stepModelIssue(s.modelChoice, s.model, s.id.trim() || s.id)
    if (issue) return { body: null, error: issue, stepKey: s.key }
    if (s.review && s.sendBack && !s.sendBackStep.trim()) {
      return {
        body: null,
        error: `Step "${s.id.trim() || s.id}": choose the step that fixes a rejection`,
        stepKey: s.key,
      }
    }
    steps.push({
      id: s.id.trim(),
      agent: s.agent,
      instructions: s.instructions,
      input: s.input,
      files: s.files,
      tools: s.ownTools ? undefined : s.tools,
      mcpServers: s.mcpServers,
      allowWrites: s.allowWrites,
      maxTurns: s.maxTurns,
      gate: s.gate,
      review: s.review,
      repair: s.review && s.sendBack ? false : s.repair,
      onReject:
        s.review && s.sendBack
          ? { step: s.sendBackStep.trim(), maxRounds: s.sendBackRounds }
          : undefined,
      login: s.login,
      ...stepModelFields(s.modelChoice, s.model),
    })
  }
  return {
    error: null,
    body: {
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
      steps,
    },
  }
}

function numberValue(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? fallback : n
}

/** The flow line between steps: how the next step gets its input, plus "add a step here". */
function StepLink({ text, canAdd, onAdd }: { text: string; canAdd: boolean; onAdd: () => void }): React.ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex w-7 shrink-0 justify-center">
        <span className="h-7 w-px bg-border" />
      </span>
      <span className="text-xs text-muted-foreground">{text}</span>
      {canAdd ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-xs text-muted-foreground"
          onClick={onAdd}
        >
          <Plus className="h-3 w-3" />
          Add step here
        </Button>
      ) : null}
    </div>
  )
}

/** Take (once) a draft the Assistant handed over; for an edit, only one with the same name. */
function takeChatDraft(name?: string): Workflow | null {
  const workflow = parseStoredWorkflowDraft(sessionStorage.getItem(WORKFLOW_DRAFT_STORAGE_KEY))
  if (!workflow || (name && workflow.name !== name)) return null
  sessionStorage.removeItem(WORKFLOW_DRAFT_STORAGE_KEY)
  return workflow
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
    stepTimeoutMinutes: DEFAULT_STEP_TIMEOUT_MINUTES,
    runTimeoutMinutes: DEFAULT_RUN_TIMEOUT_MINUTES,
    maxRetries: 1,
    selfAssess: false,
    steps: [emptyStep("step-1", "", "step-initial")],
  }))
  const [openKey, setOpenKey] = React.useState<string | null>("step-initial")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [workspaceFiles, setWorkspaceFiles] = React.useState<WorkspaceFile[]>([])
  const needsTaskModels =
    draft.model.trim().startsWith("task:") ||
    draft.steps.some((step) => isTaskSelectValue(step.modelChoice)) ||
    agents.some(
      (agent) => typeof agent.frontmatter.model === "string" && agent.frontmatter.model.trim().startsWith("task:")
    )
  const taskModels = useSavedTaskModels(needsTaskModels)

  React.useEffect(() => {
    if (!workspace?.path) {
      setWorkspaceFiles([])
      return
    }
    apiFetch<{ files: WorkspaceFile[] }>("/api/files")
      .then((data) => setWorkspaceFiles(data.files))
      .catch(() => setWorkspaceFiles([]))
  }, [workspace?.path])

  React.useEffect(() => {
    if (!name || !workspace) return
    apiFetch<{ workflow: Workflow }>(`/api/workflows/${encodeURIComponent(name)}`)
      .then(({ workflow }) => {
        const next = toDraft(takeChatDraft(name) ?? workflow)
        setDraft(next)
        setOpenKey(next.steps[0]?.key ?? null)
        setLoad({ kind: "ready" })
      })
      .catch((err: unknown) =>
        setLoad({ kind: "error", message: err instanceof Error ? err.message : "Could not load the workflow" })
      )
  }, [name, workspace])

  // A draft handed over from the Assistant ("Open in builder").
  React.useEffect(() => {
    if (name) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      const workflow = takeChatDraft()
      if (!workflow) return
      const next = toDraft(workflow)
      setDraft(next)
      setOpenKey(next.steps[0]?.key ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [name])

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
  const insertStep = (at: number): void => {
    const step = emptyStep(freeStepId(draft.steps), agents[0]?.name)
    setDraft((d) => ({ ...d, steps: [...d.steps.slice(0, at), step, ...d.steps.slice(at)] }))
    setOpenKey(step.key)
  }
  const removeStep = (key: string): void => {
    setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.key !== key) }))
    if (openKey === key) setOpenKey(null)
  }
  const canAddStep = draft.steps.length < MAX_WORKFLOW_STEPS

  async function save() {
    const input = toInput(draft)
    if (input.error) {
      setError(input.error)
      if (input.stepKey) setOpenKey(input.stepKey)
      return
    }
    const parsed = workflowSchema.safeParse(input.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const stepIndex = issue ? stepIndexOfIssue(issue.path) : null
      const stepKey = stepIndex === null ? undefined : draft.steps[stepIndex]?.key
      if (stepKey) setOpenKey(stepKey)
      const where =
        stepIndex !== null && issue
          ? `Step ${stepIndex + 1}${issue.path.length > 2 ? ` (${issue.path.slice(2).join(".")})` : ""}: `
          : issue?.path.length
            ? `${issue.path.join(".")}: `
            : ""
      setError(`${where}${issue?.message ?? "Invalid workflow"}`)
      return
    }
    setError(null)
    setSaving(true)
    try {
      const secrets: Record<string, string> = {}
      for (const step of draft.steps) {
        if (!step.login) continue
        const ids = loginSecretIds(parsed.data.name, step.id.trim())
        if (step.username.trim()) secrets[ids.username] = step.username.trim()
        if (step.password) secrets[ids.password] = step.password
      }
      if (Object.keys(secrets).length > 0) {
        await apiFetch("/api/browser/secrets", {
          method: "PUT",
          body: JSON.stringify({ secrets }),
        })
      }
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
      setDraft((current) => ({
        ...current,
        steps: current.steps.map((step) => ({ ...step, username: "", password: "" })),
      }))
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
          <div>
            <h2 className="text-base font-semibold">Steps</h2>
            <p className="text-xs text-muted-foreground">Steps run from top to bottom. Click a step to open it.</p>
          </div>
          <Button variant="outline" size="sm" disabled={!canAddStep} onClick={() => insertStep(draft.steps.length)}>
            <Plus className="h-4 w-4" />
            Add step
          </Button>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This workspace has no agents yet. <Link className="underline" href="/agents/new">Create an agent</Link> first.
          </p>
        ) : null}
        <ol aria-label="Workflow steps">
          {draft.steps.map((step, index) => (
            <li key={step.key}>
              <StepLink
                text={stepLinkText(index, step.input)}
                canAdd={index > 0 && canAddStep}
                onAdd={() => insertStep(index)}
              />
              <div className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-xs font-semibold"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <StepCard
                    step={step}
                    index={index}
                    total={draft.steps.length}
                    open={openKey === step.key}
                    agents={agents}
                    workspaceFiles={workspaceFiles}
                    modelSummary={(() => {
                      const fields = stepModelFields(step.modelChoice, step.model)
                      const agent = agents.find((item) => item.name === step.agent)
                      return effectiveModelText({
                        stepModel: fields.model,
                        stepProvider: fields.provider,
                        agentModel: agent?.frontmatter.model,
                        agentProvider: agent?.frontmatter.provider,
                        workflowModel: draft.model,
                        workflowProvider: draft.provider === "default" ? undefined : draft.provider,
                        tasks: taskModels.choices,
                      })
                    })()}
                    taskChoices={taskModels.choices}
                    otherSteps={draft.steps
                      .filter((item) => item.key !== step.key && item.id.trim())
                      .map((item) => ({ id: item.id.trim() }))}
                    onToggle={() => setOpenKey((current) => (current === step.key ? null : step.key))}
                    onChange={(patch) => setStep(step.key, patch)}
                    onMove={(delta) => moveStep(index, delta)}
                    onRemove={() => removeStep(step.key)}
                    onFilesUpdated={setWorkspaceFiles}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="pl-10">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full border border-dashed text-muted-foreground"
            disabled={!canAddStep}
            onClick={() => insertStep(draft.steps.length)}
          >
            <Plus className="h-4 w-4" />
            {canAddStep ? "Add a step at the end" : `Up to ${MAX_WORKFLOW_STEPS} steps`}
          </Button>
        </div>
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
            <Label htmlFor="wf-step-timeout">Step time limit (1–{MAX_STEP_TIMEOUT_MINUTES} min)</Label>
            <Input
              id="wf-step-timeout"
              type="number"
              min={1}
              max={MAX_STEP_TIMEOUT_MINUTES}
              value={draft.stepTimeoutMinutes}
              onChange={(e) => set("stepTimeoutMinutes", numberValue(e.target.value, draft.stepTimeoutMinutes))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-run-timeout">Run time limit (1–{MAX_RUN_TIMEOUT_MINUTES} min)</Label>
            <Input
              id="wf-run-timeout"
              type="number"
              min={1}
              max={MAX_RUN_TIMEOUT_MINUTES}
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

      {editing && name ? (
        <RunPanel
          name={name}
          defaultTask={draft.task}
          steps={draft.steps}
          workspaceFiles={workspaceFiles}
          onFilesUpdated={setWorkspaceFiles}
        />
      ) : null}
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

function RunPanel({
  name,
  defaultTask,
  steps,
  workspaceFiles,
  onFilesUpdated,
}: {
  name: string
  defaultTask: string
  steps: StepDraft[]
  workspaceFiles: WorkspaceFile[]
  onFilesUpdated: (files: WorkspaceFile[]) => void
}) {
  const router = useRouter()
  const [task, setTask] = React.useState("")
  const [stepFiles, setStepFiles] = React.useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {}
    for (const s of steps) {
      if (s.id.trim()) initial[s.id.trim()] = [...s.files]
    }
    return initial
  })
  const [runs, setRuns] = React.useState<RunSummary[] | null>(null)
  const [starting, setStarting] = React.useState(false)

  // Keep run-panel step defaults synced when the builder's step files change.
  React.useEffect(() => {
    setStepFiles((current) => {
      const next: Record<string, string[]> = {}
      for (const s of steps) {
        const id = s.id.trim()
        if (!id) continue
        next[id] = current[id] ?? [...s.files]
      }
      return next
    })
  }, [steps])

  React.useEffect(() => {
    apiFetch<{ runs: RunSummary[] }>(`/api/workflows/${encodeURIComponent(name)}/runs`)
      .then((data) => setRuns(data.runs))
      .catch(() => setRuns([]))
  }, [name])

  async function start() {
    setStarting(true)
    try {
      const hasFileOverrides = Object.values(stepFiles).some((list) => list.length > 0) ||
        steps.some((s) => s.files.length > 0)
      const { run } = await apiFetch<{ run: WorkflowRun }>(`/api/workflows/${encodeURIComponent(name)}/runs`, {
        method: "POST",
        body: JSON.stringify({
          task: task.trim() || undefined,
          ...(hasFileOverrides ? { stepFiles } : {}),
        }),
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
        {steps.length > 0 ? (
          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div>
              <p className="text-xs font-medium">Files for this run (per step)</p>
              <p className="text-xs text-muted-foreground">
                Uses each step&apos;s default files. Swap or upload files here to override for this run only.
              </p>
            </div>
            <div className="space-y-2">
              {steps.map((step, index) => {
                const stepId = step.id.trim() || `step-${index + 1}`
                const currentFiles = stepFiles[stepId] ?? step.files
                return (
                  <div key={step.key} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-2.5 py-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-medium">
                        {index + 1}. {stepId} <span className="font-normal text-muted-foreground">({step.agent || "no agent"})</span>
                      </p>
                      {currentFiles.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {currentFiles.map((fileName) => {
                            const meta = workspaceFiles.find((f) => f.name === fileName)
                            return (
                              <WorkspaceFileChip
                                key={fileName}
                                name={fileName}
                                originalName={meta?.originalName}
                                kind={meta?.kind}
                                disabled={starting}
                                onRemove={() =>
                                  setStepFiles((prev) => ({
                                    ...prev,
                                    [stepId]: currentFiles.filter((f) => f !== fileName),
                                  }))
                                }
                              />
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No files selected</p>
                      )}
                    </div>
                    <FilePickerDialog
                      selectedNames={currentFiles}
                      multiSelect
                      disabled={starting}
                      onFilesUpdated={onFilesUpdated}
                      onPick={(picked) => {
                        const exists = currentFiles.includes(picked.name)
                        const next = exists
                          ? currentFiles.filter((f) => f !== picked.name)
                          : currentFiles.length < MAX_STEP_FILES
                            ? [...currentFiles, picked.name]
                            : currentFiles
                        setStepFiles((prev) => ({ ...prev, [stepId]: next }))
                      }}
                      trigger={
                        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={starting}>
                          <FolderOpen className="h-3.5 w-3.5" />
                          Files
                        </Button>
                      }
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
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
