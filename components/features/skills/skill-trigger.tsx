"use client"

import * as React from "react"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import type { SkillSuggestion, SkillTriggerReport } from "@/lib/decision/skill-suggest"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function SkillSuggestBox(): React.ReactElement {
  const [prompt, setPrompt] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<SkillSuggestion | null>(null)

  async function suggest(): Promise<void> {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const suggestion = await apiFetch<SkillSuggestion>("/api/skills/suggest", {
        method: "POST",
        body: JSON.stringify({ prompt: text }),
      })
      setResult(suggestion)
    } catch (err) {
      setResult(null)
      toast.error(err instanceof ApiError ? err.message : "Could not suggest a skill")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Which skill fits?" className="rounded-lg border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-medium">Which skill fits?</h2>
        <p className="text-xs text-muted-foreground">
          Jev reads each skill description and picks at most one.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={2}
          placeholder="Describe the task…"
          aria-label="Task to match with a skill"
          className="min-h-16"
        />
        <Button type="button" onClick={() => void suggest()} disabled={busy || !prompt.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Suggest
        </Button>
      </div>
      {result ? <SuggestionLine suggestion={result} /> : null}
    </section>
  )
}

function SuggestionLine({ suggestion }: { suggestion: SkillSuggestion }): React.ReactElement {
  if (suggestion.kind === "picked") {
    return (
      <p className="mt-3 text-sm">
        <span className="font-medium">{suggestion.name}</span>
        <span className="text-muted-foreground">
          {" "}
          · {Math.round(suggestion.confidence * 100)}%
        </span>
      </p>
    )
  }
  if (suggestion.kind === "none") {
    return <p className="mt-3 text-sm text-muted-foreground">No skill fits this task.</p>
  }
  if (suggestion.kind === "empty") {
    return <p className="mt-3 text-sm text-muted-foreground">This workspace has no skills yet.</p>
  }
  return <p className="mt-3 text-sm text-muted-foreground">Jev could not pick a skill.</p>
}

export function SkillTriggerButton({
  name,
  description,
}: {
  name: string
  description: string
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [report, setReport] = React.useState<SkillTriggerReport | null>(null)

  async function check(): Promise<void> {
    setBusy(true)
    setReport(null)
    setOpen(true)
    try {
      const next = await apiFetch<SkillTriggerReport>("/api/skills/eval", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      })
      setReport(next)
    } catch (err) {
      setOpen(false)
      toast.error(err instanceof ApiError ? err.message : "Could not check this skill")
    } finally {
      setBusy(false)
    }
  }

  const ready = name.trim().length > 0 && description.trim().length > 0

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void check()}
        disabled={!ready || busy}
        title={ready ? "See if this description triggers for the right tasks" : "Enter a name and description first"}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Check trigger
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Skill trigger</DialogTitle>
            <DialogDescription>
              {report?.summary ?? "Checking how this description is chosen…"}
            </DialogDescription>
          </DialogHeader>
          {report?.warning ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">{report.warning}</p>
          ) : null}
          {report ? (
            <ul className="space-y-2">
              {report.probes.map((probe) => (
                <li key={`${probe.expect}:${probe.prompt}`} className="rounded-md border px-3 py-2 text-sm">
                  <p className={cn("font-medium", probe.pass ? "text-skill" : "text-destructive")}>
                    {probe.pass ? "Pass" : "Fail"} · {probe.expect === "trigger" ? "should open" : "should stay closed"}
                  </p>
                  <p className="text-muted-foreground">{probe.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    {probe.picked ? `Opened ${probe.picked}` : "Opened nothing"}
                    {probe.confidence > 0 ? ` · ${Math.round(probe.confidence * 100)}%` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking…
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
