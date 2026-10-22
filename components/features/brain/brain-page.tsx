"use client"

import * as React from "react"
import Link from "next/link"
import {
  Brain,
  Check,
  CheckCircle2,
  HelpCircle,
  History,
  Inbox,
  Library,
  Info,
  Loader2,
  MessageSquare,
  NotebookPen,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { apiFetch } from "@/lib/api"
import {
  approveEffect,
  KIND_HELP,
  KIND_LABEL,
  LINKS_HELP,
  LINKS_TITLE,
  NO_LINKS,
  linksEffect,
  MEMORY_BUDGET_CHARS,
  memoryUsage,
  proposalOrigin,
  scopeLabel,
} from "@/lib/brain/explain"
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
import { KnowledgeTab } from "@/components/features/brain/knowledge-tab"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const INTRO_DISMISSED_KEY = "black-agents:brain-intro-dismissed"

const EXAMPLE_NOTES = [
  "This repo uses pnpm, not npm.",
  "Answer in Portuguese unless I write in English.",
  "Run the unit tests with npm run test:unit before saying a task is done.",
]

function subscribeNoop(): () => void {
  return () => undefined
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: BrainOverview }

export function BrainPage(): React.ReactElement {
  const { workspace, loading, refresh } = useWorkspace()
  const [state, setState] = React.useState<LoadState>({ kind: "loading" })
  const introDismissed = React.useSyncExternalStore(
    subscribeNoop,
    () => window.localStorage.getItem(INTRO_DISMISSED_KEY) === "1",
    () => true
  )
  const [introOverride, setIntroOverride] = React.useState<boolean | null>(null)
  const introOpen = introOverride ?? !introDismissed

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

  function toggleIntro(): void {
    const next = !introOpen
    setIntroOverride(next)
    if (!next) window.localStorage.setItem(INTRO_DISMISSED_KEY, "1")
  }

  if (!workspace && !loading) return <NoWorkspace message="Select a workspace to see its brain." />

  const pending = state.kind === "ready" ? state.data.proposals.filter((p) => p.status === "pending") : []
  const decided =
    state.kind === "ready"
      ? state.data.proposals
          .filter((p) => p.status !== "pending")
          .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt))
      : []
  const noteCount =
    state.kind === "ready"
      ? state.data.workspaceNotes.length + state.data.agents.reduce((sum, a) => sum + a.notes.length, 0)
      : 0

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Brain</h1>
            <p className="text-sm text-muted-foreground">
              What your agents learn from your feedback. Nothing changes until you approve it.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={toggleIntro} aria-expanded={introOpen}>
          <HelpCircle className="h-4 w-4" />
          How it works
        </Button>
      </div>

      {introOpen ? <HowItWorks onClose={toggleIntro} /> : null}

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
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabTrigger value="inbox" icon={Inbox} label="Inbox" count={pending.length} highlight />
            <TabTrigger value="memory" icon={NotebookPen} label="Memory" count={noteCount} />
            <TabTrigger value="knowledge" icon={Library} label="Knowledge" count={0} />
            <TabTrigger value="history" icon={History} label="History" count={decided.length} />
          </TabsList>

          <TabsContent value="inbox" className="space-y-3 pt-3">
            <TabIntro>
              Changes the Brain suggests from your feedback. Read each one, edit it if you want, then approve or
              reject it.
            </TabIntro>
            {pending.length === 0 ? (
              <EmptyState
                title="The inbox is empty"
                text="Suggestions show up here after you give feedback."
              >
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/chat">
                      <MessageSquare className="h-4 w-4" />
                      Rate replies in the Assistant
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/workflows">
                      <Workflow className="h-4 w-4" />
                      Turn on self-check in a workflow
                    </Link>
                  </Button>
                </div>
              </EmptyState>
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
            <TabIntro>
              Short notes your agents remember, like preferences and lessons. They are added to every chat and
              workflow run automatically. Workspace notes go to all agents; agent notes only to that agent.
            </TabIntro>
            {noteCount === 0 ? (
              <EmptyState
                title="No memory notes yet"
                text="When you approve a “Memory note” in the Inbox, it is saved here. Notes look like this:"
              >
                <ul className="mx-auto max-w-md space-y-1.5 text-left text-sm text-muted-foreground">
                  {EXAMPLE_NOTES.map((note) => (
                    <li key={note} className="rounded-md border border-dashed px-3 py-1.5">
                      {note}
                    </li>
                  ))}
                </ul>
              </EmptyState>
            ) : (
              <>
                <MemoryUsage
                  texts={[
                    ...state.data.workspaceNotes.map((n) => n.text),
                    ...state.data.agents.flatMap((a) => a.notes.map((n) => n.text)),
                  ]}
                />
                <NotesCard
                  title="Workspace"
                  scope={scopeLabel(undefined)}
                  file=".black-agents/brain/workspace.md"
                  notes={state.data.workspaceNotes}
                  onPromoted={load}
                />
                {state.data.agents.map((a) => (
                  <NotesCard
                    key={a.name}
                    title={a.name}
                    scope={scopeLabel(a.name)}
                    file={`.black-agents/brain/agents/${a.name}.md`}
                    notes={a.notes}
                    onPromoted={load}
                  />
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-3 pt-3">
            <KnowledgeTab onQueued={load} />
          </TabsContent>

          <TabsContent value="history" className="space-y-3 pt-3">
            <TabIntro>
              Every suggestion you approved or rejected, newest first. Approved changes are also logged in{" "}
              <code className="text-xs">.black-agents/brain/log.jsonl</code>.
            </TabIntro>
            {decided.length === 0 ? (
              <EmptyState title="No decisions yet" text="Approve or reject a suggestion in the Inbox to see it here." />
            ) : (
              <ul aria-label="Decisions" className="divide-y rounded-md border">
                {decided.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant={p.status === "approved" ? "secondary" : "outline"}>
                        {p.status === "approved" ? "Approved" : "Rejected"}
                      </Badge>
                      <span className="truncate">{p.title}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <KindBadge kind={p.kind} />
                      <span>{scopeLabel(p.agent)}</span>
                      {p.resolvedAt ? <time dateTime={p.resolvedAt}>{p.resolvedAt.slice(0, 10)}</time> : null}
                    </span>
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

const STEPS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: MessageSquare,
    title: "1. You give feedback",
    text: "Rate a reply in the Assistant (thumbs up or down, with a comment), or turn on self-check in a workflow.",
  },
  {
    icon: Inbox,
    title: "2. The Brain suggests a change",
    text: "It drafts one small change: a memory note, or a better skill or rule. The change waits in the Inbox.",
  },
  {
    icon: CheckCircle2,
    title: "3. You decide",
    text: "Edit it if you want, then approve or reject. Notes go to Memory; skill and rule changes are written to their files.",
  },
]

function HowItWorks({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <section aria-labelledby="brain-how" className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="brain-how" className="text-sm font-semibold">
          How the Brain works
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Got it
        </Button>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((step) => {
          const Icon = step.icon
          return (
            <li key={step.title} className="space-y-1.5 rounded-md bg-muted/40 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4 text-primary" aria-hidden />
                {step.title}
              </p>
              <p className="text-xs text-muted-foreground">{step.text}</p>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        Memory is for preferences and lessons (“use pnpm”, “answer briefly”). Durable facts from an OKF bundle
        belong in the Knowledge tab, and they are saved only after you approve them.
      </p>
    </section>
  )
}

const TAB_HELP: Record<string, string> = {
  inbox: "Suggested changes waiting for your decision",
  memory: "Notes your agents remember in every chat",
  knowledge: "Durable facts from an OKF bundle. Nothing is saved until you approve it",
  history: "Suggestions you already approved or rejected",
}

function TabTrigger({
  value,
  icon: Icon,
  label,
  count,
  highlight = false,
}: {
  value: string
  icon: LucideIcon
  label: string
  count: number
  highlight?: boolean
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TabsTrigger value={value} aria-label={count > 0 ? `${label} (${count})` : label}>
          <Icon className="h-4 w-4" aria-hidden />
          {label}
          {count > 0 ? (
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                highlight ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15"
              )}
            >
              {count}
            </span>
          ) : null}
        </TabsTrigger>
      </TooltipTrigger>
      <TooltipContent>{TAB_HELP[value]}</TooltipContent>
    </Tooltip>
  )
}

function TabIntro({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="flex gap-2 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function EmptyState({
  title,
  text,
  children,
}: {
  title: string
  text: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-3 rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  )
}

function KindBadge({ kind }: { kind: BrainProposal["kind"] }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" tabIndex={0} className="cursor-help">
          {KIND_LABEL[kind]}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{KIND_HELP[kind]}</TooltipContent>
    </Tooltip>
  )
}

function MemoryUsage({ texts }: { texts: string[] }): React.ReactElement {
  const { chars, fits } = memoryUsage(texts)
  const percent = Math.min(100, Math.round((chars / MEMORY_BUDGET_CHARS) * 100))
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Space used in each chat</span>
        <span className="tabular-nums text-muted-foreground">
          {chars.toLocaleString("en-US")} / {MEMORY_BUDGET_CHARS.toLocaleString("en-US")} characters
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Memory space used"
        aria-valuemin={0}
        aria-valuemax={MEMORY_BUDGET_CHARS}
        aria-valuenow={Math.min(chars, MEMORY_BUDGET_CHARS)}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full", fits ? "bg-primary" : "bg-amber-500")} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {fits
          ? "All notes fit, so every note is sent."
          : "Full: only the newest notes, or the ones that match the task, are sent."}
      </p>
    </div>
  )
}

function noteSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "")
  return slug || "note"
}

function PromoteNote({
  text,
  fieldKey,
  onPromoted,
}: {
  text: string
  fieldKey: string
  onPromoted: () => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [id, setId] = React.useState(noteSlug(text))
  const [type, setType] = React.useState("Reference")
  const [busy, setBusy] = React.useState(false)

  async function queue(): Promise<void> {
    setBusy(true)
    try {
      const data = await apiFetch<{ title: string }>("/api/brain/promote", {
        method: "POST",
        body: JSON.stringify({ id, type, content: text, title: text.slice(0, 80) }),
      })
      toast.success(`“${data.title}” is in the Inbox. Approve it there to save it.`)
      setOpen(false)
      onPromoted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the concept")
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => setOpen(true)}>
        Save as knowledge
      </Button>
    )
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border p-2">
      <p className="text-xs text-muted-foreground">
        This adds an Inbox item. The note stays in Memory until you approve the concept.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`promote-${fieldKey}`}>Concept id</Label>
          <Input id={`promote-${fieldKey}`} value={id} onChange={(e) => setId(e.target.value)} spellCheck={false} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`promote-type-${fieldKey}`}>Type</Label>
          <Input id={`promote-type-${fieldKey}`} value={type} onChange={(e) => setType(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void queue()} disabled={busy || !id.trim() || !type.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add to inbox
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function NotesCard({
  title,
  scope,
  file,
  notes,
  onPromoted,
}: {
  title: string
  scope: string
  file: string
  notes: BrainNote[]
  onPromoted: () => void
}): React.ReactElement | null {
  if (notes.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {title}
          <Badge variant="outline" className="font-normal">
            {scope}
          </Badge>
          <span className="text-xs font-normal text-muted-foreground">
            {notes.length} note{notes.length === 1 ? "" : "s"}
          </span>
        </CardTitle>
        <CardDescription>
          Saved in <code className="text-xs">{file}</code>. Edit that file to change or remove a note.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {notes.map((n, i) => (
            <li key={`${n.date}-${i}`} className="space-y-1">
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">{n.date}</span>
                <span className="min-w-0 flex-1 break-words">{n.text}</span>
                <PromoteNote text={n.text} fieldKey={`${title}-${i}`} onPromoted={onPromoted} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ProposalCard({ proposal, onDecided }: { proposal: BrainProposal; onDecided: () => void }): React.ReactElement {
  const [content, setContent] = React.useState(proposal.content)
  const [description, setDescription] = React.useState(proposal.description ?? "")
  const [busy, setBusy] = React.useState<"approve" | "reject" | null>(null)
  const suggestions = proposal.links ?? []
  const [linkIds, setLinkIds] = React.useState<string[]>(() => suggestions.map((link) => link.id))
  const isReverification = proposal.kind === "reverify_concept"
  const isArtifact = proposal.kind !== "memory_note" && !isReverification
  const isConceptWrite = proposal.kind === "new_concept" || proposal.kind === "update_concept"

  function toggleLink(id: string, on: boolean): void {
    setLinkIds((current) => (on ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id)))
  }

  async function decide(action: "approve" | "reject"): Promise<void> {
    setBusy(action)
    try {
      const edits =
        action === "approve"
          ? {
              content: content !== proposal.content ? content : undefined,
              description:
                isArtifact && description.trim() && description !== proposal.description
                  ? description.trim()
                  : undefined,
              links: isConceptWrite && linkIds.length > 0 ? linkIds : undefined,
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
          <KindBadge kind={proposal.kind} />
          {proposal.target ? (
            <Badge variant="outline" className="font-mono text-xs">
              {proposal.target.type}:{proposal.target.name}
            </Badge>
          ) : null}
          {proposal.kind === "new_concept" ||
          proposal.kind === "update_concept" ||
          proposal.kind === "reverify_concept" ? (
            <Badge variant="outline">Knowledge</Badge>
          ) : (
            <Badge variant="outline">{scopeLabel(proposal.agent)}</Badge>
          )}
          <span className="text-xs text-muted-foreground">{proposalOrigin(proposal)}</span>
        </div>
        <CardTitle className="text-base">{proposal.title}</CardTitle>
        {proposal.rationale && !isReverification ? (
          <CardDescription>Why: {proposal.rationale}</CardDescription>
        ) : null}
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
        {isReverification ? (
          <div className="space-y-1.5 rounded-md bg-muted/40 p-3">
            <p className="text-xs font-medium">Why this needs review</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.content}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={`${proposal.id}-content`}>
              {proposal.kind === "new_concept" || proposal.kind === "update_concept"
                ? "Concept text"
                : isArtifact
                  ? "New body"
                  : "Note"}
            </Label>
            <Textarea
              id={`${proposal.id}-content`}
              rows={isArtifact ? 10 : 2}
              className="font-mono text-xs"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">You can edit this before you approve.</p>
          </div>
        )}
        {isConceptWrite ? (
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium">{LINKS_TITLE}</legend>
            {suggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{NO_LINKS}</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{LINKS_HELP}</p>
                <ul className="space-y-2">
                  {suggestions.map((link) => (
                    <li key={link.id}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={linkIds.includes(link.id)}
                          onChange={(e) => toggleLink(link.id, e.target.checked)}
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="block font-medium">{link.title}</span>
                          <span className="block text-xs text-muted-foreground">{link.reason}</span>
                          <code className="block truncate text-xs text-muted-foreground">{link.id}</code>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{linksEffect(linkIds.length)}</p>
              </>
            )}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void decide("approve")}
            disabled={busy !== null || (!isReverification && !content.trim())}
          >
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </Button>
          <Button variant="outline" onClick={() => void decide("reject")} disabled={busy !== null}>
            {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject
          </Button>
          <span className="text-xs text-muted-foreground">{approveEffect(proposal)}</span>
        </div>
      </CardContent>
    </Card>
  )
}
