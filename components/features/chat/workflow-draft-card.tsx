"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, Save, Wand2, Workflow as WorkflowIcon } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { WORKFLOW_DRAFT_STORAGE_KEY } from "@/lib/llm/workflow-draft"
import type { Workflow } from "@/lib/workflows/schema"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function WorkflowDraftCard({
  workflow,
  exists,
  onSaved,
}: {
  workflow: Workflow
  /** A workflow with this name is already in the workspace (save updates it). */
  exists: boolean
  onSaved: (name: string) => void
}): React.ReactElement {
  const router = useRouter()
  const { byType } = useWorkspace()
  const agentNames = new Set(byType("agent").map((a) => a.name))
  const missing = [...new Set(workflow.steps.map((s) => s.agent).filter((a) => !agentNames.has(a)))]
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (exists) {
        await apiFetch(`/api/workflows/${encodeURIComponent(workflow.name)}`, {
          method: "PUT",
          body: JSON.stringify(workflow),
        })
      } else {
        await apiFetch("/api/workflows", { method: "POST", body: JSON.stringify(workflow) })
      }
      setSaved(true)
      toast.success(exists ? "Workflow updated" : "Workflow created")
      onSaved(workflow.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the workflow")
    } finally {
      setSaving(false)
    }
  }

  function openInBuilder(): void {
    sessionStorage.setItem(WORKFLOW_DRAFT_STORAGE_KEY, JSON.stringify(workflow))
    router.push(exists ? `/workflows/${encodeURIComponent(workflow.name)}` : "/workflows/new")
  }

  return (
    <div className="rounded-lg border bg-card p-3 text-left" data-testid="workflow-draft-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <WorkflowIcon className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{workflow.name}</p>
            {workflow.description ? (
              <p className="truncate text-xs text-muted-foreground">{workflow.description}</p>
            ) : null}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          Workflow
        </Badge>
      </div>
      <ol className="mt-3 space-y-1 text-xs" aria-label="Workflow steps">
        {workflow.steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
              {index + 1}
            </span>
            <span className="font-medium">{step.agent}</span>
            {step.instructions ? (
              <span className="truncate text-muted-foreground">{step.instructions}</span>
            ) : null}
          </li>
        ))}
      </ol>
      {missing.length > 0 ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Missing agents: {missing.join(", ")}. Create them before saving.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            Saved. Start it with /{workflow.name}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href={`/workflows/${encodeURIComponent(workflow.name)}`}>View workflow</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => void save()} disabled={saving || missing.length > 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {exists ? "Update workflow" : "Save workflow"}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={openInBuilder}>
            <Wand2 className="h-4 w-4" />
            Open in builder
          </Button>
        </div>
      )}
    </div>
  )
}
