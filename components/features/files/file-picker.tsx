"use client"

import * as React from "react"
import {
  Check,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { formatBytes } from "@/lib/chat/attachments"
import { uploadWorkspaceFile } from "@/lib/files/client"
import type { WorkspaceFile, WorkspaceFileKind } from "@/lib/files/schema"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function WorkspaceFileIcon({
  kind,
  className,
}: {
  kind: WorkspaceFileKind
  className?: string
}) {
  switch (kind) {
    case "image":
      return <FileImage className={cn("h-4 w-4 text-sky-500", className)} />
    case "pdf":
      return <FileText className={cn("h-4 w-4 text-rose-500", className)} />
    case "text":
      return <FileCode className={cn("h-4 w-4 text-emerald-500", className)} />
    case "binary":
    default:
      return <FileArchive className={cn("h-4 w-4 text-amber-500", className)} />
  }
}

export function WorkspaceFileChip({
  name,
  originalName,
  kind = "binary",
  onRemove,
  disabled,
}: {
  name: string
  originalName?: string
  kind?: WorkspaceFileKind
  onRemove?: () => void
  disabled?: boolean
}) {
  return (
    <span
      className="inline-flex max-w-72 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
      title={originalName ? `@file:${name} (${originalName})` : `@file:${name}`}
    >
      <WorkspaceFileIcon kind={kind} className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-mono font-medium">@file:{name}</span>
      {originalName ? (
        <span className="truncate text-muted-foreground">({originalName})</span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label={`Remove @file:${name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  )
}

export interface FilePickerDialogProps {
  /** Currently selected file names (`name` handles). */
  selectedNames?: string[]
  /** Called when the user toggles or picks a file. */
  onPick: (file: WorkspaceFile) => void
  /** Optional callback when files are loaded or uploaded so parent can stay in sync. */
  onFilesUpdated?: (files: WorkspaceFile[]) => void
  /** Keep dialog open on pick (multi-select mode) or close immediately (single-action mode). */
  multiSelect?: boolean
  disabled?: boolean
  trigger?: React.ReactNode
  title?: string
  description?: string
}

export function FilePickerDialog({
  selectedNames = [],
  onPick,
  onFilesUpdated,
  multiSelect = false,
  disabled = false,
  trigger,
  title = "Workspace Files",
  description = "Pick a file from your workspace library or upload a new one for browser forms and tasks.",
}: FilePickerDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [files, setFiles] = React.useState<WorkspaceFile[]>([])
  const [loading, setLoading] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const loadFiles = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ files: WorkspaceFile[] }>("/api/files")
      setFiles(data.files)
      onFilesUpdated?.(data.files)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load workspace files")
    } finally {
      setLoading(false)
    }
  }, [onFilesUpdated])

  React.useEffect(() => {
    if (open) {
      void loadFiles()
    }
  }, [open, loadFiles])

  async function handleUpload(picked: File[]) {
    if (picked.length === 0) return
    setUploading(true)
    try {
      const created: WorkspaceFile[] = []
      for (const item of picked) {
        try {
          const saved = await uploadWorkspaceFile(item)
          created.push(saved)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Could not upload "${item.name}"`)
        }
      }
      if (created.length > 0) {
        const data = await apiFetch<{ files: WorkspaceFile[] }>("/api/files")
        setFiles(data.files)
        onFilesUpdated?.(data.files)
        for (const saved of created) {
          onPick(saved)
        }
        toast.success(
          created.length === 1
            ? `Uploaded @file:${created[0].name}`
            : `Uploaded ${created.length} files`
        )
        if (!multiSelect && created.length === 1) {
          setOpen(false)
        }
      }
    } finally {
      setUploading(false)
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return files
    return files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.originalName.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q)
    )
  }, [files, query])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm" disabled={disabled}>
            <FolderOpen className="h-4 w-4" />
            Add file
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by handle, filename, or note…"
                className="pl-8"
                aria-label="Search workspace files"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              data-testid="file-picker-upload-input"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                e.target.value = ""
                void handleUpload(picked)
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload new
            </Button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading files" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="space-y-2 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {files.length === 0
                    ? "No files in this workspace yet."
                    : "No files match your search."}
                </p>
                {files.length === 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    <Plus className="h-4 w-4" />
                    Upload your first file
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y" role="listbox" aria-label="Workspace files">
                {filtered.map((file) => {
                  const selected = selectedNames.includes(file.name)
                  return (
                    <li key={file.name}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onPick(file)
                          if (!multiSelect) setOpen(false)
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60",
                          selected && "bg-primary/5"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <WorkspaceFileIcon kind={file.kind} className="shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-mono text-xs font-semibold">
                                @file:{file.name}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {file.originalName}
                              </span>
                            </div>
                            {file.description ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {file.description}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline" className="text-[11px] font-normal">
                            {formatBytes(file.size)}
                          </Badge>
                          {selected ? (
                            <Check className="h-4 w-4 text-primary" aria-label="Selected" />
                          ) : null}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
