"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { HelpCircle, Loader2, NotebookPen, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import { metaForType } from "@/lib/artifacts/constants"
import { DRAFT_STORAGE_KEY } from "@/lib/llm/draft"
import { WORKFLOW_DRAFT_STORAGE_KEY } from "@/lib/llm/workflow-draft"
import {
  BUILD_EFFECT,
  CONSENT_LABEL,
  DELETE_EFFECT,
  DOCX_MESSAGE,
  IMPORT_EFFECT,
  LIMITS_LINE,
  MEETINGS_INTRO,
  MEETINGS_STEPS,
  MEETINGS_TITLE,
  SAVE_EFFECT,
  notesLanguageLine,
  savePathLine,
} from "@/lib/meetings/explain"
import { knowledgeFilePath } from "@/lib/meetings/notes"
import { resolveListenChoice } from "@/lib/meetings/models"
import type { Meeting, MeetingSuggestion } from "@/lib/meetings/schema"
import { useAssistantProvider } from "@/components/features/editor/use-assistant-provider"
import { transcribeImportedAudio } from "@/components/features/meetings/import-audio"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

const INTRO_KEY = "blackagents.meetings.intro"
const AUDIO_FILE = /\.(mp3|wav|m4a|webm|ogg|mp4)$/i
const TEXT_FILE = /\.(txt|md|vtt|srt)$/i

function subscribeNoop(): () => void {
  return () => undefined
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; meetings: Meeting[] }

export function MeetingsPage(): React.ReactElement {
  const router = useRouter()
  const { workspace, loading: workspaceLoading, project, setActiveProject } = useWorkspace()
  const assistant = useAssistantProvider()
  const [state, setState] = React.useState<LoadState>({ kind: "loading" })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const introDismissed = React.useSyncExternalStore(
    subscribeNoop,
    () => window.localStorage.getItem(INTRO_KEY) === "1",
    () => true
  )
  const [introOverride, setIntroOverride] = React.useState<boolean | null>(null)
  const introOpen = introOverride ?? !introDismissed

  const load = React.useCallback((quiet = false): void => {
    if (!quiet) setState({ kind: "loading" })
    apiFetch<{ meetings: Meeting[] }>("/api/meetings")
      .then((data) => setState({ kind: "ready", meetings: data.meetings }))
      .catch((err: unknown) =>
        setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load meetings" })
      )
  }, [])

  React.useEffect(() => {
    if (!workspace) return
    let active = true
    apiFetch<{ meetings: Meeting[] }>("/api/meetings")
      .then((data) => {
        if (active) setState({ kind: "ready", meetings: data.meetings })
      })
      .catch((err: unknown) => {
        if (active) {
          setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load meetings" })
        }
      })
    return () => {
      active = false
    }
  }, [workspace])

  const meetings = state.kind === "ready" ? state.meetings : []
  const selected = meetings.find((meeting) => meeting.id === selectedId) ?? meetings[0] ?? null
  const unsaved = Boolean(selected?.notes && !selected.knowledgeProposalId)

  React.useEffect(() => {
    if (!unsaved) return
    const onLeave = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", onLeave)
    return () => window.removeEventListener("beforeunload", onLeave)
  }, [unsaved])

  function toggleIntro(): void {
    const next = !introOpen
    setIntroOverride(next)
    if (!next) window.localStorage.setItem(INTRO_KEY, "1")
  }

  async function writeNotes(meeting: Meeting): Promise<Meeting> {
    const resolved = assistant.resolve()
    return apiFetch<Meeting>(`/api/meetings/${meeting.id}/notes`, {
      method: "POST",
      body: JSON.stringify(resolved?.model ? { provider: resolved.provider, model: resolved.model } : {}),
    })
  }

  async function onImported(meeting: Meeting): Promise<void> {
    setSelectedId(meeting.id)
    try {
      const noted = await writeNotes(meeting)
      setSelectedId(noted.id)
      toast.success("Notes are ready. Review them before you save.")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not write notes")
    }
    load(true)
  }

  async function saveKnowledge(meeting: Meeting): Promise<void> {
    try {
      const result = await apiFetch<{ file: string; already?: boolean }>(`/api/meetings/${meeting.id}/knowledge`, {
        method: "POST",
      })
      toast.success(result.already ? "This note is already in Brain." : "Sent to Brain. Approve it there to save the note.")
      load(true)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send the note")
    }
  }

  async function buildFrom(meeting: Meeting, suggestion: MeetingSuggestion): Promise<void> {
    const resolved = assistant.resolve()
    try {
      const built = await apiFetch<
        | { kind: "workflow"; workflow: { name: string } }
        | { kind: "artifact"; draft: { type: "agent" | "skill" | "rule" | "command"; name: string } }
      >(`/api/meetings/${meeting.id}/build`, {
        method: "POST",
        body: JSON.stringify({
          kind: suggestion.kind,
          name: suggestion.name,
          ...(resolved?.model ? { provider: resolved.provider, model: resolved.model } : {}),
        }),
      })
      if (meeting.scope && meeting.scope !== project?.id) {
        const switched = await setActiveProject(meeting.scope)
        if (!switched) return
      }
      if (built.kind === "workflow") {
        sessionStorage.setItem(WORKFLOW_DRAFT_STORAGE_KEY, JSON.stringify(built.workflow))
        router.push("/workflows/new")
        return
      }
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(built.draft))
      router.push(`/${metaForType(built.draft.type).route}/new`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open a draft")
    }
  }

  async function remove(meeting: Meeting): Promise<void> {
    try {
      await apiFetch(`/api/meetings/${meeting.id}`, { method: "DELETE" })
      setSelectedId(null)
      toast.success("Meeting deleted")
      load(true)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete the meeting")
    }
  }

  if (!workspace && !workspaceLoading) {
    return <NoWorkspace message="Select a workspace to keep meeting notes." />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <NotebookPen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{MEETINGS_TITLE}</h1>
            <p className="text-sm text-muted-foreground">{MEETINGS_INTRO}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={toggleIntro} aria-expanded={introOpen}>
            <HelpCircle className="h-4 w-4" />
            How it works
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import
          </Button>
        </div>
      </div>

      {introOpen ? (
        <section aria-labelledby="meetings-how" className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="meetings-how" className="text-sm font-semibold">
              How meetings work
            </h2>
            <Button variant="ghost" size="sm" onClick={toggleIntro}>
              Got it
            </Button>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {MEETINGS_STEPS.map((step) => (
              <li key={step.title} className="space-y-1.5 rounded-md bg-muted/40 p-3">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {state.kind === "loading" || workspaceLoading ? (
        <div className="space-y-2" aria-busy="true">
          <p className="text-sm text-muted-foreground">Loading meetings…</p>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : state.kind === "error" ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-4 text-sm">
          <span className="text-destructive">{state.message}</span>
          <Button size="sm" variant="outline" onClick={() => load()}>
            Retry
          </Button>
        </div>
      ) : meetings.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed p-6">
          <h2 className="text-base font-medium">No meetings yet</h2>
          <p className="text-sm text-muted-foreground">
            Paste a transcript from Google Meet, Zoom, Teams, or any other app. You can also drop a caption file or an
            audio file.
          </p>
          <p className="text-xs text-muted-foreground">{LIMITS_LINE}</p>
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import a meeting
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ul className="space-y-1">
            {meetings.map((meeting) => (
              <li key={meeting.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(meeting.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    selected?.id === meeting.id ? "bg-muted" : "hover:bg-muted/60"
                  }`}
                >
                  <span className="block truncate font-medium">{meeting.title}</span>
                  <span className="text-xs text-muted-foreground">{meeting.startedAt.slice(0, 10)}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <MeetingDetail
              meeting={selected}
              onNotes={() => {
                void writeNotes(selected)
                  .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Could not write notes"))
                  .finally(() => load(true))
              }}
              onSave={() => void saveKnowledge(selected)}
              onBuild={(suggestion) => void buildFrom(selected, suggestion)}
              onDelete={() => void remove(selected)}
            />
          ) : null}
        </div>
      )}

      <ImportDialog
        open={importOpen}
        projectId={project?.id}
        onOpenChange={setImportOpen}
        onDone={(meeting) => void onImported(meeting)}
      />
    </div>
  )
}

function MeetingDetail({
  meeting,
  onNotes,
  onSave,
  onBuild,
  onDelete,
}: {
  meeting: Meeting
  onNotes: () => void
  onSave: () => void
  onBuild: (suggestion: MeetingSuggestion) => void
  onDelete: () => void
}): React.ReactElement {
  const notes = meeting.notes
  const file = knowledgeFilePath(meeting)
  return (
    <article className="space-y-4 rounded-lg border p-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{meeting.title}</h2>
          <Badge variant={meeting.status === "failed" ? "outline" : "secondary"}>
            {meeting.status === "ready" ? "Notes ready" : meeting.status === "failed" ? "Notes failed" : "Waiting for notes"}
          </Badge>
          {meeting.scope ? <Badge variant="outline">{meeting.scope}</Badge> : null}
        </div>
        {notes ? <p className="text-sm text-muted-foreground">{notesLanguageLine(notes.language)}</p> : null}
        {meeting.error ? <p className="text-sm text-destructive">{meeting.error}</p> : null}
      </header>

      {notes ? (
        <div className="space-y-3 text-sm">
          <p>{notes.summary}</p>
          <NoteList title="Decisions" items={notes.decisions} />
          <NoteList
            title="Action items"
            items={notes.actionItems.map((item) => `${item.owner ? `${item.owner}: ` : ""}${item.task}${item.due ? ` (${item.due})` : ""}`)}
          />
          <NoteList title="Open questions" items={notes.openQuestions} />
          <NoteList title="People" items={notes.people} />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">The transcript is saved. Notes are not written yet.</p>
          <Button size="sm" onClick={onNotes}>
            Write notes
          </Button>
        </div>
      )}

      {notes && notes.suggestions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Build from this meeting</h3>
          <p className="text-xs text-muted-foreground">{BUILD_EFFECT}</p>
          <ul className="space-y-2">
            {notes.suggestions.map((suggestion) => (
              <li key={`${suggestion.kind}-${suggestion.name}`}>
                <Button variant="outline" size="sm" onClick={() => onBuild(suggestion)}>
                  {suggestion.kind} · {suggestion.name}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">{suggestion.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 border-t pt-3">
        {meeting.knowledgeProposalId ? (
          <Button size="sm" variant="outline" asChild>
            <Link href="/brain">Review in Brain</Link>
          </Button>
        ) : (
          <Button size="sm" disabled={!notes} onClick={onSave}>
            Send to Brain
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {SAVE_EFFECT} {savePathLine(file)}
        </p>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          Delete meeting
        </Button>
        <p className="text-xs text-muted-foreground">{DELETE_EFFECT}</p>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Transcript</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {meeting.segments.map((segment, index) => (
            <li key={`${segment.at}-${index}`}>
              <span className="text-muted-foreground">{segment.speaker}: </span>
              {segment.text}
            </li>
          ))}
        </ul>
      </details>
    </article>
  )
}

function NoteList({ title, items }: { title: string; items: string[] }): React.ReactElement {
  return (
    <section>
      <h3 className="font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="text-muted-foreground">None noted.</p>
      ) : (
        <ul className="list-disc pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ImportDialog({
  open,
  projectId,
  onOpenChange,
  onDone,
}: {
  open: boolean
  projectId?: string
  onOpenChange: (open: boolean) => void
  onDone: (meeting: Meeting) => void
}): React.ReactElement {
  const [title, setTitle] = React.useState("")
  const [text, setText] = React.useState("")
  const [file, setFile] = React.useState<File | null>(null)
  const [consent, setConsent] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<string | null>(null)
  const audio = Boolean(file && AUDIO_FILE.test(file.name))

  function reset(): void {
    setTitle("")
    setText("")
    setFile(null)
    setConsent(false)
    setProgress(null)
  }

  async function submit(): Promise<void> {
    setBusy(true)
    setProgress(null)
    try {
      let segments: Meeting["segments"] | undefined
      let bodyText = text.trim()
      if (file) {
        if (/\.docx$/i.test(file.name)) throw new ApiError(DOCX_MESSAGE)
        if (audio) {
          if (!consent) throw new ApiError(CONSENT_LABEL)
          const settings = await apiFetch<{
            settings: { models: { voice?: string; meeting?: { listen?: { provider: "openai" | "custom"; model: string } } } }
          }>("/api/settings/ai")
          segments = await transcribeImportedAudio({
            file,
            listen: resolveListenChoice({
              listen: settings.settings.models.meeting?.listen,
              voice: settings.settings.models.voice,
            }),
            onProgress: (done, total) => setProgress(`Reading part ${done} of ${total}…`),
          })
          bodyText = ""
        } else if (TEXT_FILE.test(file.name)) {
          bodyText = await file.text()
        } else {
          throw new ApiError("Use a text file (txt, md, vtt, srt) or an audio file.")
        }
      }
      if (!bodyText && !segments) throw new ApiError("Paste a transcript or choose a file.")
      const meeting = await apiFetch<Meeting>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(projectId ? { scope: projectId } : {}),
          ...(segments ? { segments } : { text: bodyText }),
        }),
      })
      reset()
      onOpenChange(false)
      onDone(meeting)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not import the meeting")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a meeting</DialogTitle>
          <DialogDescription>{IMPORT_EFFECT}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="meeting-title">Title</Label>
            <Input id="meeting-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Weekly standup" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="meeting-text">Transcript</Label>
            <Textarea
              id="meeting-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={6}
              placeholder="Paste the transcript here"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="meeting-file">Or choose a file</Label>
            <Input
              id="meeting-file"
              type="file"
              accept=".txt,.md,.vtt,.srt,.mp3,.wav,.m4a,.webm,.ogg"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">{LIMITS_LINE}</p>
          </div>
          {audio ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              {CONSENT_LABEL}
            </label>
          ) : null}
          {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy || (audio && !consent)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Read this meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
