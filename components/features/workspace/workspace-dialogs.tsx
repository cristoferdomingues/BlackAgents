"use client"

import * as React from "react"
import { Check, CircleCheck, Code2, Coins, FileCode, FolderPlus, Loader2, Sparkles, TriangleAlert } from "lucide-react"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { WorkspaceTemplate } from "@/lib/artifacts/schemas"
import { WORKSPACE_TEMPLATES } from "@/lib/workspace/templates"
import { ACTION, WORKSPACE_DIALOG } from "@/lib/settings/explain"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface CheckResult {
  exists: boolean
  isDirectory: boolean
  canCreate?: boolean
  path?: string
  platforms: { id: string; label: string }[]
}

type WorkspaceDialog = "create" | "open" | null

interface WorkspaceDialogsValue {
  openCreate: () => void
  openExisting: () => void
}

const WorkspaceDialogsContext = React.createContext<WorkspaceDialogsValue | null>(null)

const TEMPLATE_ICONS: Record<WorkspaceTemplate, React.ComponentType<{ className?: string }>> = {
  crypto: Coins,
  software: Code2,
  blank: FileCode,
}

/** Create and Open workspace dialogs, reachable from the header, empty states, and Settings. */
export function WorkspaceDialogsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [dialog, setDialog] = React.useState<WorkspaceDialog>(null)
  const value = React.useMemo<WorkspaceDialogsValue>(
    () => ({ openCreate: () => setDialog("create"), openExisting: () => setDialog("open") }),
    []
  )
  const onOpenChange = (open: boolean): void => {
    if (!open) setDialog(null)
  }
  return (
    <WorkspaceDialogsContext.Provider value={value}>
      {children}
      <CreateWorkspaceDialog open={dialog === "create"} onOpenChange={onOpenChange} />
      <OpenWorkspaceDialog open={dialog === "open"} onOpenChange={onOpenChange} />
    </WorkspaceDialogsContext.Provider>
  )
}

export function useWorkspaceDialogs(): WorkspaceDialogsValue {
  const value = React.useContext(WorkspaceDialogsContext)
  if (!value) throw new Error("useWorkspaceDialogs must be used inside WorkspaceDialogsProvider")
  return value
}

/** Checks a typed path after a short pause. */
function usePathCheck(path: string): { check: CheckResult | null; checking: boolean } {
  const [check, setCheck] = React.useState<CheckResult | null>(null)
  const [checking, setChecking] = React.useState(false)
  React.useEffect(() => {
    const trimmed = path.trim()
    if (!trimmed) {
      const timer = setTimeout(() => {
        setCheck(null)
        setChecking(false)
      }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(async () => {
      setChecking(true)
      try {
        setCheck(await apiFetch<CheckResult>(`/api/workspace/check?path=${encodeURIComponent(trimmed)}`))
      } catch {
        setCheck(null)
      } finally {
        setChecking(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [path])
  return { check, checking }
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const { createWorkspace } = useWorkspace()
  const [path, setPath] = React.useState("")
  const [template, setTemplate] = React.useState<WorkspaceTemplate>("crypto")
  const [creating, setCreating] = React.useState(false)
  const { check, checking } = usePathCheck(path)
  const canCreate = Boolean(path.trim() && (!check?.exists || check.isDirectory))

  async function create(): Promise<void> {
    if (!canCreate) return
    setCreating(true)
    const created = await createWorkspace(path.trim(), template)
    setCreating(false)
    if (created) {
      setPath("")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{WORKSPACE_DIALOG.createTitle}</DialogTitle>
          <DialogDescription>{WORKSPACE_DIALOG.createText}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label id="starter-kit-label">Starter kit</Label>
            <div role="radiogroup" aria-labelledby="starter-kit-label" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(Object.keys(WORKSPACE_TEMPLATES) as WorkspaceTemplate[]).map((key) => {
                const tmpl = WORKSPACE_TEMPLATES[key]
                const Icon = TEMPLATE_ICONS[key]
                const selected = template === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTemplate(key)}
                    className={cn(
                      "relative flex flex-col items-start justify-between rounded-lg border p-3 text-left transition-all hover:bg-muted/60",
                      selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"
                    )}
                  >
                    <div className="mb-2 flex w-full items-center justify-between gap-1">
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-md",
                          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <Badge variant={selected ? "default" : "secondary"} className="px-1.5 py-0 text-[10px]">
                        {tmpl.badge}
                      </Badge>
                    </div>
                    <p className="text-xs font-semibold">{tmpl.name}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                      {tmpl.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-workspace-path">Workspace location</Label>
            <div className="flex gap-2">
              <Input
                id="create-workspace-path"
                placeholder="~/Dev/my-crypto-hub or /Users/you/Dev/crypto-agents"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate && !creating) void create()
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <Button disabled={!canCreate || creating} onClick={() => void create()} className="shrink-0 gap-1.5">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Create
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{ACTION.createWorkspace}</p>
            {path.trim() ? (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                {checking ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking location…
                  </span>
                ) : check?.exists ? (
                  <span className="flex items-center gap-1 text-foreground">
                    <CircleCheck className="h-3.5 w-3.5" /> Folder already exists. Starter artifacts are added to it.
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-primary">
                    <Check className="h-3.5 w-3.5" /> A new folder is made at this location.
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function OpenWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const { workspaces, addWorkspace } = useWorkspace()
  const [path, setPath] = React.useState("")
  const [adding, setAdding] = React.useState(false)
  const { check, checking } = usePathCheck(path)
  const valid = Boolean(check?.exists && check.isDirectory)
  const target = check?.path ?? path.trim()
  const noPlatform = valid && (check?.platforms.length ?? 0) === 0
  const alreadyAdded = valid && workspaces.some((w) => w.path === target)

  async function add(): Promise<void> {
    setAdding(true)
    const added = await addWorkspace(target)
    setAdding(false)
    if (added) {
      setPath("")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{WORKSPACE_DIALOG.openTitle}</DialogTitle>
          <DialogDescription>{WORKSPACE_DIALOG.openText}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="open-workspace-path">Folder path</Label>
          <div className="flex gap-2">
            <Input
              id="open-workspace-path"
              placeholder="/Users/you/Dev/my-project"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !alreadyAdded && !adding) void add()
              }}
              spellCheck={false}
              autoComplete="off"
            />
            <Button disabled={!valid || alreadyAdded || adding} onClick={() => void add()} className="shrink-0 gap-1.5">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              Open
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{ACTION.openWorkspace}</p>
          {path.trim() ? (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              {checking ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                </span>
              ) : valid ? (
                <span className="flex items-center gap-1 text-primary">
                  <Check className="h-3.5 w-3.5" /> Folder found
                </span>
              ) : (
                <span className="flex items-center gap-1 text-destructive">
                  <TriangleAlert className="h-3.5 w-3.5" /> No folder at this path
                </span>
              )}
              {valid
                ? check?.platforms.map((p) => (
                    <Badge key={p.id} variant="secondary">
                      {p.label}
                    </Badge>
                  ))
                : null}
              {noPlatform ? (
                <span className="text-muted-foreground">No .cursor or .claude folder. You can still add artifacts.</span>
              ) : null}
              {alreadyAdded ? <span className="text-muted-foreground">Already in your workspace list.</span> : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
