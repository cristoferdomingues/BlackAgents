"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Check,
  Copy,
  FolderOpen,
  Loader2,
  MessageSquarePlus,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { formatBytes } from "@/lib/chat/attachments"
import { uploadWorkspaceFile } from "@/lib/files/client"
import {
  MAX_WORKSPACE_FILE_BYTES,
  type WorkspaceFile,
  type WorkspaceFileKind,
} from "@/lib/files/schema"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { WorkspaceFileIcon } from "@/components/features/files/file-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type FilterKind = "all" | WorkspaceFileKind

const FILTER_TABS: Array<{ id: FilterKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "text", label: "Text & Data" },
  { id: "binary", label: "Other" },
]

export function FilesPage() {
  const router = useRouter()
  const { workspace, loading: workspaceLoading } = useWorkspace()
  const [files, setFiles] = React.useState<WorkspaceFile[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [filterKind, setFilterKind] = React.useState<FilterKind>("all")
  const [query, setQuery] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const loadFiles = React.useCallback(async () => {
    if (!workspace?.path) {
      setFiles([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{ files: WorkspaceFile[] }>("/api/files")
      setFiles(data.files)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load workspace files")
    } finally {
      setLoading(false)
    }
  }, [workspace?.path])

  React.useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  async function handleFilesUpload(picked: File[]) {
    if (picked.length === 0) return
    setUploading(true)
    try {
      let uploadedCount = 0
      for (const file of picked) {
        try {
          const saved = await uploadWorkspaceFile(file)
          setFiles((current) => [saved, ...current.filter((item) => item.name !== saved.name)])
          uploadedCount++
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Could not upload "${file.name}"`)
        }
      }
      if (uploadedCount > 0) {
        toast.success(
          uploadedCount === 1 ? "File added to workspace library" : `${uploadedCount} files added`
        )
      }
    } finally {
      setUploading(false)
    }
  }

  function handleFileUpdated(updated: WorkspaceFile, previousName: string) {
    setFiles((current) =>
      current.map((item) => (item.name === previousName ? updated : item))
    )
  }

  function handleFileDeleted(name: string) {
    setFiles((current) => current.filter((item) => item.name !== name))
  }

  function openInAssistant(name: string) {
    sessionStorage.setItem("black-agents:prefill-chat", `@file:${name} `)
    router.push("/chat")
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return files.filter((file) => {
      if (filterKind !== "all" && file.kind !== filterKind) return false
      if (!q) return true
      return (
        file.name.toLowerCase().includes(q) ||
        file.originalName.toLowerCase().includes(q) ||
        file.description.toLowerCase().includes(q)
      )
    })
  }, [files, filterKind, query])

  if (!workspace && !workspaceLoading) {
    return <NoWorkspace message="Select a workspace to manage Media & Files for your agents and workflows." />
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Media & Files</h1>
            <p className="text-sm text-muted-foreground">
              Add files once, mention them with <code className="rounded bg-muted px-1 py-0.5 text-xs">@file:name</code> in Assistant, or bind them to Workflow steps for browser uploads.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="files-upload-input"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              e.target.value = ""
              void handleFilesUpload(picked)
            }}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !workspace}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload files
          </Button>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const dropped = Array.from(e.dataTransfer.files ?? [])
          void handleFilesUpload(dropped)
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border bg-card/50 hover:border-primary/40"
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Drag & drop files here, or{" "}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-primary underline hover:opacity-80"
            >
              browse from your computer
            </button>
          </p>
          <p className="text-xs text-muted-foreground">
            Any format up to {formatBytes(MAX_WORKSPACE_FILE_BYTES)} (PDF, images, CSV, XLSX, DOCX, ZIP…). Stored in <code className="font-mono">.black-agents/files/</code> so Playwright MCP can upload them directly into browser forms.
          </p>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void loadFiles()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Filter files by type">
          {FILTER_TABS.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filterKind === tab.id}
              variant={filterKind === tab.id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterKind(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="pl-8"
            aria-label="Search files"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading files" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {files.length === 0 ? "Your workspace file library is empty" : "No matching files"}
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                {files.length === 0
                  ? "Upload forms, receipts, images, or spreadsheets so agents and workflow steps can use them without re-uploading every time."
                  : "Try clearing the search or choosing another file type tab."}
              </p>
            </div>
            {files.length === 0 ? (
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                Upload a file
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((file) => (
            <FileCard
              key={file.name}
              file={file}
              onUpdated={(updated) => handleFileUpdated(updated, file.name)}
              onDeleted={() => handleFileDeleted(file.name)}
              onUseInChat={() => openInAssistant(file.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileCard({
  file,
  onUpdated,
  onDeleted,
  onUseInChat,
}: {
  file: WorkspaceFile
  onUpdated: (file: WorkspaceFile) => void
  onDeleted: () => void
  onUseInChat: () => void
}) {
  const [description, setDescription] = React.useState(file.description)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    setDescription(file.description)
  }, [file.description])

  const dirty = description.trim() !== file.description

  async function saveDescription() {
    if (!dirty) return
    setSaving(true)
    try {
      const data = await apiFetch<{ file: WorkspaceFile }>(
        `/api/files/${encodeURIComponent(file.name)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ description: description.trim() }),
        }
      )
      onUpdated(data.file)
      toast.success("File note saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update file")
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await apiFetch(`/api/files/${encodeURIComponent(file.name)}`, { method: "DELETE" })
      onDeleted()
      toast.success(`Removed @file:${file.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete file")
      setDeleting(false)
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(`@file:${file.name}`)
      setCopied(true)
      toast.success(`Copied @file:${file.name}`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  return (
    <Card className="flex flex-col justify-between" data-testid={`file-card-${file.name}`}>
      <CardHeader className="space-y-2 pb-3">
        {file.kind === "image" ? (
          <div className="flex h-32 w-full items-center justify-center overflow-hidden rounded-md border bg-muted/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${encodeURIComponent(file.name)}?raw=1`}
              alt={file.originalName}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <WorkspaceFileIcon kind={file.kind} className="shrink-0" />
            <CardTitle className="truncate font-mono text-sm">@file:{file.name}</CardTitle>
          </div>
          <Badge variant="outline" className="shrink-0 text-[11px] font-normal">
            {formatBytes(file.size)}
          </Badge>
        </div>
        <CardDescription className="truncate text-xs" title={file.originalName}>
          {file.originalName} · {file.mimeType}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`desc-${file.name}`} className="text-xs text-muted-foreground">
            Agent note (optional)
          </Label>
          <div className="flex gap-1.5">
            <Input
              id={`desc-${file.name}`}
              value={description}
              maxLength={300}
              placeholder="e.g. Receipt PDF for monthly expense form"
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void saveDescription()
                }
              }}
              className="h-8 text-xs"
            />
            {dirty ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 px-2.5 text-xs"
                disabled={saving}
                onClick={() => void saveDescription()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void copyToken()}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              Copy @file
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onUseInChat}
            >
              <MessageSquarePlus className="h-3 w-3" />
              Use in Chat
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            disabled={deleting}
            onClick={() => void remove()}
            aria-label={`Delete ${file.name}`}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
