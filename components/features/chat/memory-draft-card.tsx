"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Inbox, Loader2, NotebookPen, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { scopeLabel } from "@/lib/brain/explain"
import type { MemoryDraft } from "@/lib/llm/memory-draft"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface ProposalResult {
  proposalId: string
  title: string
  agent: string | null
}

export function MemoryDraftCard({ draft }: { draft: MemoryDraft }): React.ReactElement {
  const [sending, setSending] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function sendToInbox(): Promise<void> {
    setSending(true)
    setError(null)
    try {
      await apiFetch<ProposalResult>("/api/brain/memory", {
        method: "POST",
        body: JSON.stringify(draft),
      })
      setSent(true)
      toast.success("Memory note sent to the Brain Inbox")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this note to the Inbox")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3 text-left" data-testid="memory-draft-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{draft.title}</p>
            <p className="text-xs text-muted-foreground">{scopeLabel(draft.agent)}</p>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          Memory
        </Badge>
      </div>
      <p className="mt-2 text-sm">{draft.content}</p>
      {error ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            In the Inbox. Nothing is saved yet.
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/brain">Review in Brain</Link>
          </Button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            Nothing is saved until you approve it in Brain.
          </p>
          <Button size="sm" className="mt-2 w-full" disabled={sending} onClick={() => void sendToInbox()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Inbox className="h-4 w-4" />}
            Send to Inbox
          </Button>
        </>
      )}
    </div>
  )
}

export function MemoryDraftProblemCard({
  message,
  onFix,
  fixDisabled,
}: {
  message: string
  onFix: (request: string) => void
  fixDisabled: boolean
}): React.ReactElement {
  return (
    <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">The memory note could not be opened</p>
          <p className="text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-3 w-full"
        disabled={fixDisabled}
        onClick={() =>
          onFix(
            `Your memory note could not be read. ${message} Send it again in one valid \`\`\`memory JSON block.`
          )
        }
      >
        <Wand2 className="h-4 w-4" />
        Ask to fix
      </Button>
    </div>
  )
}
