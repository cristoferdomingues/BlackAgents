"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, BookOpen, CheckCircle2, Inbox, Loader2, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { KnowledgeDraft } from "@/lib/llm/knowledge-draft"
import type { KnowledgeListItem } from "@/lib/knowledge/view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface ProposalResult {
  proposalId: string
  title: string
  kind: "new_concept" | "update_concept"
}

export function KnowledgeDraftCard({ draft }: { draft: KnowledgeDraft }): React.ReactElement {
  const [exists, setExists] = React.useState<boolean | null>(null)
  const [sending, setSending] = React.useState(false)
  const [sent, setSent] = React.useState<ProposalResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    apiFetch<{ concepts: KnowledgeListItem[] }>("/api/knowledge")
      .then((data) => {
        if (!cancelled) setExists(data.concepts.some((concept) => concept.id === draft.id))
      })
      .catch(() => {
        if (!cancelled) setExists(null)
      })
    return () => {
      cancelled = true
    }
  }, [draft.id])

  async function sendToInbox(): Promise<void> {
    setSending(true)
    setError(null)
    try {
      const result = await apiFetch<ProposalResult>("/api/knowledge/propose", {
        method: "POST",
        body: JSON.stringify(draft),
      })
      setSent(result)
      toast.success("Knowledge draft sent to the Brain Inbox")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this draft to the Inbox")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3 text-left" data-testid="knowledge-draft-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{draft.title}</p>
            <code className="block truncate text-xs text-muted-foreground">{draft.id}</code>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {exists === null ? "Knowledge" : exists ? "Update" : "New"}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{draft.description}</p>
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs">{draft.body}</p>
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

export function KnowledgeDraftProblemCard({
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
          <p className="text-sm font-medium">The knowledge draft could not be opened</p>
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
            `Your knowledge draft could not be read. ${message} Send the full draft again in one valid \`\`\`knowledge JSON block.`
          )
        }
      >
        <Wand2 className="h-4 w-4" />
        Ask to fix
      </Button>
    </div>
  )
}
