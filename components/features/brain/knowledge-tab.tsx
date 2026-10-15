"use client"

import * as React from "react"
import { FolderInput, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import { KNOWLEDGE_TAB_INTRO, type BundlePreview } from "@/lib/knowledge/explain"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** Preview an OKF folder and send one concept to the Inbox. Nothing is saved here. */
export function KnowledgeTab({ onQueued }: { onQueued: () => void }): React.ReactElement {
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
