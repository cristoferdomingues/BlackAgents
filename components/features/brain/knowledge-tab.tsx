"use client"

import * as React from "react"
import { FolderInput, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import {
  KNOWLEDGE_IMPORT_CHOICE,
  KNOWLEDGE_TAB_INTRO,
  OBSIDIAN_IMPORT_INTRO,
  OBSIDIAN_NOTE_LIMIT,
  type BundlePreview,
  type ObsidianPreview,
  type ObsidianQueueResult,
} from "@/lib/knowledge/explain"
import { KnowledgeLibrary } from "@/components/features/brain/knowledge-library"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

type SourceMode = "okf" | "obsidian"

/** Read saved concepts, or preview an OKF folder or an Obsidian vault. */
export function KnowledgeTab({ onQueued }: { onQueued: () => void }): React.ReactElement {
  const [mode, setMode] = React.useState<SourceMode>("okf")

  return (
    <div className="space-y-8">
      <KnowledgeLibrary />
      <section className="space-y-3" aria-label="Bring notes in">
        <div>
          <h2 className="text-sm font-medium">Bring notes in</h2>
          <p className="text-sm text-muted-foreground">
            Pick a folder below. Add a concept to the Inbox, then approve it there to save it.
          </p>
        </div>
        <div role="radiogroup" aria-label={KNOWLEDGE_IMPORT_CHOICE} className="grid gap-2 sm:grid-cols-2">
          <SourceChoice
            checked={mode === "okf"}
            title="OKF folder"
            text="A folder that is already Open Knowledge Format 0.2."
            onChoose={() => setMode("okf")}
          />
          <SourceChoice
            checked={mode === "obsidian"}
            title="Obsidian vault"
            text="Notes with wikilinks. BlackAgents turns them into OKF concepts."
            onChoose={() => setMode("obsidian")}
          />
        </div>
        {mode === "okf" ? <OkfImport onQueued={onQueued} /> : <ObsidianImport onQueued={onQueued} />}
      </section>
    </div>
  )
}

function SourceChoice({
  checked,
  title,
  text,
  onChoose,
}: {
  checked: boolean
  title: string
  text: string
  onChoose: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onChoose}
      className={cn("rounded-md border p-3 text-left", checked ? "border-primary bg-muted/40" : "hover:bg-muted/40")}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{text}</span>
    </button>
  )
}

function OkfImport({ onQueued }: { onQueued: () => void }): React.ReactElement {
  const [folder, setFolder] = React.useState("")
  const [preview, setPreview] = React.useState<BundlePreview | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  async function runPreview(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy("preview")
    try {
      const data = await apiFetch<BundlePreview>("/api/knowledge/import", {
        method: "POST",
        body: JSON.stringify({ action: "preview", path: folder }),
      })
      setPreview(data)
    } catch (err) {
      setPreview(null)
      toast.error(errorText(err, "Could not read that folder"))
    } finally {
      setBusy(null)
    }
  }

  async function queue(id: string): Promise<void> {
    setBusy(id)
    try {
      const result = await apiFetch<{ title: string }>("/api/knowledge/import", {
        method: "POST",
        body: JSON.stringify({ action: "queue", path: preview?.path ?? folder, id }),
      })
      toast.success(`“${result.title}” is in the Inbox. Approve it there to save it.`)
      onQueued()
    } catch (err) {
      toast.error(errorText(err, "Could not add that concept"))
    } finally {
      setBusy(null)
    }
  }

  const concepts = preview
    ? preview.levels.flatMap((level) => level.sections.flatMap((section) => section.entries.filter((entry) => entry.kind === "concept")))
    : []

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{KNOWLEDGE_TAB_INTRO}</p>
      <form onSubmit={(event) => void runPreview(event)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="okf-folder">Bundle folder</Label>
          <Input
            id="okf-folder"
            value={folder}
            placeholder="/path/to/okf-bundle"
            onChange={(event) => setFolder(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy !== null || folder.trim() === ""}>
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
          Preview
        </Button>
      </form>

      {preview ? (
        <div className="space-y-3" aria-label="Bundle preview">
          <p className="text-xs text-muted-foreground">
            {preview.version ? `OKF ${preview.version}. ` : "No version was declared, so it is read as OKF 0.2. "}
            Nothing has been saved.
          </p>
          {concepts.length === 0 && preview.orphans.length === 0 ? (
            <p className="text-sm text-muted-foreground">This folder has no concepts.</p>
          ) : (
            <ul className="space-y-2">
              {concepts.map((entry) => (
                <li key={entry.target} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{entry.title || entry.target}</span>
                    <code className="text-xs text-muted-foreground">{entry.target}</code>
                    {entry.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{entry.description}</span> : null}
                  </span>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void queue(entry.target)}>
                    {busy === entry.target ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Add to inbox
                  </Button>
                </li>
              ))}
              {preview.orphans.map((id) => (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{id}</span>
                    <span className="text-xs text-muted-foreground">Not linked from any index.</span>
                  </span>
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void queue(id)}>
                    Add to inbox
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {preview.missing.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              The index links {preview.missing.length} missing {preview.missing.length === 1 ? "file" : "files"}:{" "}
              {preview.missing.map((link) => link.target).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ObsidianImport({ onQueued }: { onQueued: () => void }): React.ReactElement {
  const [folder, setFolder] = React.useState("")
  const [preview, setPreview] = React.useState<ObsidianPreview | null>(null)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)

  async function runPreview(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    try {
      const data = await apiFetch<ObsidianPreview>("/api/knowledge/import", {
        method: "POST",
        body: JSON.stringify({ action: "preview-obsidian", path: folder }),
      })
      setPreview(data)
      setPicked(new Set(data.concepts.filter((concept) => concept.state === "new").map((concept) => concept.id)))
    } catch (err) {
      setPreview(null)
      toast.error(errorText(err, "Could not read that vault"))
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: string): void {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function queue(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const result = await apiFetch<ObsidianQueueResult>("/api/knowledge/import", {
        method: "POST",
        body: JSON.stringify({ action: "queue-obsidian", path: preview?.path ?? folder, ids }),
      })
      const added = result.queued.length
      const skipped = result.skipped.length
      toast.success(
        added === 0
          ? "Nothing new was added to the Inbox."
          : `${added} ${added === 1 ? "concept is" : "concepts are"} in the Inbox. Approve them there to save.`
      )
      if (skipped > 0) toast.message(`${skipped} skipped.`)
      onQueued()
      setPreview((current) =>
        current
          ? {
              ...current,
              concepts: current.concepts.map((concept) =>
                result.queued.some((item) => item.id === concept.id) ? { ...concept, state: "pending" } : concept
              ),
            }
          : current
      )
      setPicked(new Set())
    } catch (err) {
      toast.error(errorText(err, "Could not add those notes"))
    } finally {
      setBusy(false)
    }
  }

  const fresh = preview?.concepts.filter((concept) => concept.state === "new") ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{OBSIDIAN_IMPORT_INTRO}</p>
      <form onSubmit={(event) => void runPreview(event)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="obsidian-vault">Vault folder</Label>
          <Input
            id="obsidian-vault"
            value={folder}
            placeholder="/path/to/obsidian-vault"
            onChange={(event) => setFolder(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy || folder.trim() === ""}>
          {busy && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
          Preview
        </Button>
      </form>
      {preview ? (
        <div className="space-y-3" aria-label="Vault preview">
          <p className="text-xs text-muted-foreground">
            {preview.concepts.length} {preview.concepts.length === 1 ? "note" : "notes"} found · {fresh.length} new.
            Nothing is saved until you approve it in the Inbox. Up to {OBSIDIAN_NOTE_LIMIT.toLocaleString()} notes can be
            imported at once.
          </p>
          {preview.concepts.length === 0 ? (
            <p className="text-sm text-muted-foreground">This vault has no notes.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || picked.size === 0} onClick={() => void queue([...picked])}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add selected ({picked.size})
                </Button>
                <Button size="sm" variant="outline" disabled={busy || fresh.length === 0} onClick={() => void queue(fresh.map((concept) => concept.id))}>
                  Add all new ({fresh.length})
                </Button>
              </div>
              <ul className="space-y-2">
                {preview.concepts.map((concept) => {
                  const locked = concept.state !== "new"
                  return (
                    <li key={concept.id} className="flex items-start gap-2 rounded-md border px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={picked.has(concept.id)}
                        disabled={locked || busy}
                        aria-label={`Select ${concept.title}`}
                        onChange={() => toggle(concept.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{concept.title}</span>
                        <code className="text-xs text-muted-foreground">{concept.id}</code>
                        {concept.description ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">{concept.description}</span>
                        ) : null}
                        {concept.state === "saved" ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Already saved{concept.savedAs && concept.savedAs !== concept.id ? ` as ${concept.savedAs}` : ""}.
                          </span>
                        ) : null}
                        {concept.state === "pending" ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">Already in the Inbox.</span>
                        ) : null}
                        {concept.error ? <span className="mt-0.5 block text-xs text-destructive">{concept.error}</span> : null}
                        {concept.warnings.length > 0 ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {concept.warnings.length} link{concept.warnings.length === 1 ? "" : "s"} could not be matched.
                          </span>
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
