"use client"

import * as React from "react"
import { Brain, Check, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { BrainNote, BrainOverview, BrainProposal } from "@/lib/brain/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

const KIND_LABEL: Record<BrainProposal["kind"], string> = {
  memory_note: "Memory note",
  update_skill: "Update skill",
  new_skill: "New skill",
  update_rule: "Update rule",
  new_rule: "New rule",
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: BrainOverview }

export function BrainPage() {
  const { workspace, loading, refresh } = useWorkspace()
  const [state, setState] = React.useState<LoadState>({ kind: "loading" })

  const load = React.useCallback((): void => {
    apiFetch<BrainOverview>("/api/brain")
      .then((data) => setState({ kind: "ready", data }))
      .catch((err: unknown) =>
        setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load the brain" })
      )
  }, [])

  React.useEffect(() => {
    if (workspace) load()
  }, [workspace, load])

  if (!workspace && !loading) return <NoWorkspace message="Select a workspace to see its brain." />

  const pending = state.kind === "ready" ? state.data.proposals.filter((p) => p.status === "pending") : []
  const decided = state.kind === "ready" ? state.data.proposals.filter((p) => p.status !== "pending") : []

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Brain</h1>
          <p className="text-sm text-muted-foreground">
            What your agents learned. Nothing changes until you approve it.
          </p>
        </div>
      </div>

      {state.kind === "loading" ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading brain" />
        </div>
      ) : state.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}{" "}
          <Button variant="link" size="sm" onClick={load}>
            Retry
          </Button>
        </p>
      ) : (
        <Tabs defaultValue="inbox" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="inbox">Inbox{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="inbox" className="space-y-3 pt-3">
            {pending.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                The inbox is empty. Rate replies in the Assistant or turn on self-assessment in a workflow.
              </p>
            ) : (
              pending.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  onDecided={() => {
                    load()
                    if (p.kind !== "memory_note") void refresh()
                  }}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="memory" className="space-y-3 pt-3">
            <NotesCard title="Workspace" description="Shared by every agent." notes={state.data.workspaceNotes} />
            {state.data.agents.map((a) => (
              <NotesCard key={a.name} title={a.name} description="This agent's own notes." notes={a.notes} />
            ))}
            {state.data.workspaceNotes.length === 0 && state.data.agents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No memory notes yet.</p>
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="pt-3">
            {decided.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No decisions yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {decided.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Badge variant={p.status === "approved" ? "secondary" : "outline"}>
                        {p.status === "approved" ? "Approved" : "Rejected"}
                      </Badge>
                      {p.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{KIND_LABEL[p.kind]}</span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function NotesCard({ title, description, notes }: { title: string; description: string; notes: BrainNote[] }) {
  if (notes.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {notes.map((n, i) => (
            <li key={`${n.date}-${i}`} className="flex gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">{n.date}</span>
              <span className="break-words">{n.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ProposalCard({ proposal, onDecided }: { proposal: BrainProposal; onDecided: () => void }) {
  const [content, setContent] = React.useState(proposal.content)
  const [description, setDescription] = React.useState(proposal.description ?? "")
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null)
  const isArtifact = proposal.kind !== "memory_note"

  async function decide(action: "approve" | "reject") {
    setBusy(action)
    try {
      const edits =
        action === "approve"
          ? {
              content: content !== proposal.content ? content : undefined,
              description: isArtifact && description.trim() && description !== proposal.description ? description.trim() : undefined,
            }
          : undefined
      await apiFetch(`/api/brain/proposals/${encodeURIComponent(proposal.id)}`, {
        method: "POST",
        body: JSON.stringify({ action, edits }),
      })
      toast.success(action === "approve" ? "Applied" : "Rejected")
      onDecided()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the decision")
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{KIND_LABEL[proposal.kind]}</Badge>
          {proposal.target ? (
            <Badge variant="outline" className="font-mono text-xs">
              {proposal.target.type}:{proposal.target.name}
            </Badge>
          ) : null}
          <Badge variant="outline">{proposal.agent ? `Brain: ${proposal.agent}` : "Workspace brain"}</Badge>
          <span className="text-xs text-muted-foreground">
            {proposal.decision.by === "jev"
              ? `Jev chose this (confidence ${(proposal.decision.confidence ?? 0).toFixed(2)})`
              : "From your feedback"}
          </span>
        </div>
        <CardTitle className="text-base">{proposal.title}</CardTitle>
        {proposal.rationale ? <CardDescription>{proposal.rationale}</CardDescription> : null}
        {proposal.source.comment ? (
          <p className="text-xs text-muted-foreground">Your comment: “{proposal.source.comment}”</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {isArtifact ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${proposal.id}-description`}>Description</Label>
            <Input id={`${proposal.id}-description`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`${proposal.id}-content`}>{isArtifact ? "New body" : "Note"}</Label>
          <Textarea
            id={`${proposal.id}-content`}
            rows={isArtifact ? 10 : 2}
            className="font-mono text-xs"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void decide("approve")} disabled={busy !== null || !content.trim()}>
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </Button>
          <Button variant="outline" onClick={() => void decide("reject")} disabled={busy !== null}>
            {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
