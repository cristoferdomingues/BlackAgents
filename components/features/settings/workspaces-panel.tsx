"use client"

import * as React from "react"
import { CircleCheck, FolderOpen, FolderPlus, Loader2, Sparkles, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { ACTION, EMPTY } from "@/lib/settings/explain"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { useWorkspaceDialogs } from "@/components/features/workspace/workspace-dialogs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/** Settings → Workspaces: the saved folders, with create and open in dialogs. */
export function WorkspacesPanel(): React.ReactElement {
  const { workspace, workspaces, setActive, removeWorkspace } = useWorkspace()
  const { openCreate, openExisting } = useWorkspaceDialogs()
  const [busyPath, setBusyPath] = React.useState<string | null>(null)

  async function run(path: string, action: (path: string) => Promise<unknown>): Promise<void> {
    setBusyPath(path)
    await action(path)
    setBusyPath(null)
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={openCreate}>
        <Sparkles className="h-4 w-4" />
        New workspace
      </Button>
      <Button size="sm" variant="outline" onClick={openExisting}>
        <FolderPlus className="h-4 w-4" />
        Open folder
      </Button>
    </div>
  )

  if (workspaces.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed px-4 py-8 text-center">
        <p className="text-sm font-medium">{EMPTY.workspacesTitle}</p>
        <p className="text-sm text-muted-foreground">{EMPTY.workspacesText}</p>
        <div className="flex justify-center">{actions}</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {actions}
      <p className="text-xs text-muted-foreground">
        {ACTION.setActive} {ACTION.removeWorkspace}
      </p>
      <ul className="space-y-1 rounded-lg border p-2">
        {workspaces.map((ws) => {
          const isActive = workspace?.path === ws.path
          const busy = busyPath === ws.path
          return (
            <li
              key={ws.path}
              className={cn(
                "group flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors",
                isActive ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted"
              )}
            >
              {isActive ? (
                <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{ws.name}</p>
                  {isActive ? (
                    <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                      Active
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">{ws.path}</p>
              </div>
              {!isActive ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  title={ACTION.setActive}
                  onClick={() => void run(ws.path, setActive)}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Set active
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Remove ${ws.name}`}
                title={ACTION.removeWorkspace}
                disabled={busy}
                onClick={() => void run(ws.path, removeWorkspace)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
