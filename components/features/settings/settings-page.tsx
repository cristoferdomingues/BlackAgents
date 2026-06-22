"use client"

import * as React from "react"
import {
  Check,
  CircleCheck,
  FolderOpen,
  FolderPlus,
  Loader2,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

interface CheckResult {
  exists: boolean
  isDirectory: boolean
  path?: string
  platforms: { id: string; label: string }[]
}

export function SettingsPage() {
  const { workspace, workspaces, addWorkspace, setActive, removeWorkspace } =
    useWorkspace()
  const [value, setValue] = React.useState("")
  const [check, setCheck] = React.useState<CheckResult | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const [busyPath, setBusyPath] = React.useState<string | null>(null)

  React.useEffect(() => {
    const trimmed = value.trim()
    if (!trimmed) {
      setCheck(null)
      return
    }
    setChecking(true)
    const handle = setTimeout(async () => {
      try {
        const result = await apiFetch<CheckResult>(
          `/api/workspace/check?path=${encodeURIComponent(trimmed)}`
        )
        setCheck(result)
      } catch {
        setCheck(null)
      } finally {
        setChecking(false)
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [value])

  const valid = Boolean(check?.exists && check.isDirectory)
  const noPlatform = valid && check!.platforms.length === 0
  const alreadyAdded =
    valid && workspaces.some((w) => w.path === (check!.path ?? value.trim()))

  async function add() {
    setAdding(true)
    const okAdded = await addWorkspace(check!.path ?? value.trim())
    setAdding(false)
    if (okAdded) setValue("")
  }

  async function activate(path: string) {
    setBusyPath(path)
    await setActive(path)
    setBusyPath(null)
  }

  async function remove(path: string) {
    setBusyPath(path)
    await removeWorkspace(path)
    setBusyPath(null)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage the project folders BlackAgents works with.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a workspace</CardTitle>
          <CardDescription>
            Enter the absolute path to a project (a folder containing a{" "}
            <code className="rounded bg-muted px-1">.cursor</code> or{" "}
            <code className="rounded bg-muted px-1">.claude</code> directory).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="workspace-path">Project path</Label>
            <div className="flex gap-2">
              <Input
                id="workspace-path"
                placeholder="/Users/you/Dev/my-project"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid && !alreadyAdded && !adding) add()
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                disabled={!valid || alreadyAdded || adding}
                onClick={add}
              >
                {adding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                Add
              </Button>
            </div>

            {value.trim() ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {checking ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                  </span>
                ) : valid ? (
                  <span className="flex items-center gap-1 text-skill">
                    <Check className="h-3 w-3" /> Valid directory
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-destructive">
                    <TriangleAlert className="h-3 w-3" /> Not a directory
                  </span>
                )}
                {valid
                  ? check!.platforms.map((p) => (
                      <Badge key={p.id} variant="secondary">
                        {p.label}
                      </Badge>
                    ))
                  : null}
                {noPlatform ? (
                  <span className="text-muted-foreground">
                    No .cursor/.claude found — you can still create artifacts.
                  </span>
                ) : null}
                {alreadyAdded ? (
                  <span className="text-muted-foreground">
                    Already in your workspaces.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your workspaces</CardTitle>
          <CardDescription>
            Select which workspace is active. The active one is what every page
            reads and writes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {workspaces.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No workspaces yet. Add one above to get started.
            </p>
          ) : (
            workspaces.map((ws) => {
              const isActive = workspace?.path === ws.path
              const busy = busyPath === ws.path
              return (
                <div
                  key={ws.path}
                  className={cn(
                    "group flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary/5"
                      : "border-transparent hover:bg-muted"
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
                    <p className="truncate text-xs text-muted-foreground">
                      {ws.path}
                    </p>
                  </div>
                  {!isActive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => activate(ws.path)}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Set active
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label={`Remove ${ws.name}`}
                    disabled={busy}
                    onClick={() => remove(ws.path)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
