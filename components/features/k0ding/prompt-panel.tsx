"use client"

import * as React from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import { diffCounts, lineDiff } from "@/lib/k0ding/diff"
import { APPLY_EFFECT, DISCARD_EFFECT, RUN_EFFECT, SEND_EFFECT } from "@/lib/k0ding/explain"
import type { CodingSessionView, CommandResult, FileView, StagedChange } from "@/lib/k0ding/schema"
import type { ApprovalRequest } from "@/lib/runtime/types"
import { ApprovalCard } from "@/components/features/approvals/approval-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

interface PromptPanelProps {
  rootId: string
  pinned: string[]
  onUnpin: (path: string) => void
  session: CodingSessionView | null
  activity: string[]
  live: string
  running: boolean
  onSend: (prompt: string) => void
  onStop: () => void
  onSession: (session: CodingSessionView) => void
  onApplied: (session: CodingSessionView, all: boolean) => void
  onRun: (command: string) => Promise<CommandResult | null>
  approval: ApprovalRequest | null
}

export function PromptPanel({
  rootId,
  pinned,
  onUnpin,
  session,
  activity,
  live,
  running,
  onSend,
  onStop,
  onSession,
  onApplied,
  onRun,
  approval,
}: PromptPanelProps): React.ReactElement {
  const [prompt, setPrompt] = React.useState("")
  const [busyPath, setBusyPath] = React.useState<string | null>(null)
  const pending = (session?.changes ?? []).filter((change) => change.state === "pending" || change.state === "conflict")

  function send(): void {
    const text = prompt.trim()
    if (!text || running) return
    setPrompt("")
    onSend(text)
  }

  async function decide(path: string, action: "apply" | "discard"): Promise<void> {
    if (!session) return
    setBusyPath(path || action)
    try {
      const next = await apiFetch<CodingSessionView>(`/api/k0ding/sessions/${session.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ paths: path ? [path] : pending.map((change) => change.path) }),
      })
      onSession(next)
      onApplied(next, action === "apply" && path === "")
      const conflicts = next.changes.filter((change) => change.state === "conflict")
      if (conflicts.length > 0) toast.error("A file changed on disk. It was not written.")
      else toast.success(action === "apply" ? "Files written" : "Changes dropped")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update the changes")
    }
    setBusyPath(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {approval ? (
          <ApprovalCard approval={approval} rememberLabel="Allow this exact command for the rest of this session" />
        ) : null}
        <RunBox disabled={running} onRun={onRun} />
        {live ? <p className="whitespace-pre-wrap text-sm">{live}</p> : session?.summary ? <p className="whitespace-pre-wrap text-sm">{session.summary}</p> : null}
        {activity.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {activity.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        ) : null}
        {pending.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Changes ({pending.length})</p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={busyPath !== null} onClick={() => void decide("", "discard")}>
                  Discard all
                </Button>
                <Button size="sm" disabled={busyPath !== null} onClick={() => void decide("", "apply")}>
                  Apply all
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{APPLY_EFFECT}</p>
            {pending.map((change) => (
              <ChangeCard
                key={change.path}
                rootId={rootId}
                change={change}
                busy={busyPath === change.path || busyPath === "apply" || busyPath === "discard"}
                onApply={() => void decide(change.path, "apply")}
                onDiscard={() => void decide(change.path, "discard")}
              />
            ))}
          </div>
        ) : null}
      </div>
      <form
        className="space-y-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {pinned.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {pinned.map((path) => (
              <Badge key={path} variant="secondary" className="gap-1">
                <span className="max-w-40 truncate">{path}</span>
                <button type="button" aria-label={`Unpin ${path}`} onClick={() => onUnpin(path)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Say what to build or change"
          aria-label="What should K0ding do?"
          className="min-h-20"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{SEND_EFFECT}</p>
          {running ? (
            <Button type="button" size="sm" variant="outline" onClick={onStop}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!prompt.trim()}>
              Send
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{DISCARD_EFFECT}</p>
      </form>
    </div>
  )
}

function RunBox({
  disabled,
  onRun,
}: {
  disabled: boolean
  onRun: (command: string) => Promise<CommandResult | null>
}): React.ReactElement {
  const [command, setCommand] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<CommandResult | null>(null)

  async function run(): Promise<void> {
    const text = command.trim()
    if (!text || busy) return
    setBusy(true)
    const next = await onRun(text)
    setResult(next)
    setBusy(false)
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        void run()
      }}
    >
      <div className="flex gap-2">
        <Input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="npm test"
          aria-label="Command"
          className="h-8"
          disabled={disabled || busy}
        />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || busy || !command.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Run
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{RUN_EFFECT}</p>
      {result ? (
        <pre className="max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[11px]">
          {result.timedOut ? "Timed out\n" : `Exit ${String(result.exitCode)}\n`}
          {result.stdout}
          {result.stderr}
        </pre>
      ) : null}
    </form>
  )
}

function ChangeCard({
  rootId,
  change,
  busy,
  onApply,
  onDiscard,
}: {
  rootId: string
  change: StagedChange
  busy: boolean
  onApply: () => void
  onDiscard: () => void
}): React.ReactElement {
  const [before, setBefore] = React.useState<string | null>(change.kind === "create" ? "" : null)
  const [conflict, setConflict] = React.useState(change.state === "conflict")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (change.kind === "create" || change.kind === "delete") return
    let cancelled = false
    apiFetch<FileView>(`/api/k0ding/roots/${rootId}/file?path=${encodeURIComponent(change.path)}`)
      .then((file) => {
        if (cancelled) return
        setBefore(file.content ?? "")
        setConflict(Boolean(change.baseHash && file.hash && file.hash !== change.baseHash))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not read the current file")
      })
    return () => {
      cancelled = true
    }
  }, [rootId, change.path, change.kind, change.baseHash])

  const diff = before !== null && change.kind !== "delete" ? lineDiff(before, change.content ?? "") : null
  const counts = diff && !diff.truncated ? diffCounts(diff.lines) : null

  return (
    <article className="space-y-2 rounded-md border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{change.path}</p>
          <p className="text-[11px] text-muted-foreground">
            {change.kind === "delete" ? "Will be deleted" : change.kind === "create" ? "New file" : "Changed"}
            {counts ? ` · +${counts.added} -${counts.removed}` : ""}
          </p>
        </div>
        {conflict ? <Badge variant="destructive">Conflict</Badge> : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {change.kind === "delete" ? null : diff?.truncated ? (
        <p className="text-xs text-muted-foreground">The diff is large. You can still apply the file.</p>
      ) : diff ? (
        <pre className="max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-4">
          {diff.lines.map((line, index) => (
            <div
              key={`${line.kind}-${index}`}
              className={
                line.kind === "add"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : line.kind === "del"
                    ? "bg-destructive/10 text-destructive"
                    : "text-muted-foreground"
              }
            >
              {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
              {line.text}
            </div>
          ))}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground">Loading diff…</p>
      )}
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={busy || conflict} onClick={onDiscard}>
          Discard
        </Button>
        <Button size="sm" disabled={busy || conflict} onClick={onApply}>
          Apply
        </Button>
      </div>
    </article>
  )
}
