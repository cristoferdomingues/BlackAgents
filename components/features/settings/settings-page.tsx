"use client"

import * as React from "react"
import {
  Check,
  FolderOpen,
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
import { Separator } from "@/components/ui/separator"

interface CheckResult {
  exists: boolean
  isDirectory: boolean
  path?: string
  platforms: { id: string; label: string }[]
}

export function SettingsPage() {
  const { workspace, recents, selectWorkspace } = useWorkspace()
  const [value, setValue] = React.useState("")
  const [check, setCheck] = React.useState<CheckResult | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

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

  const valid = check?.exists && check.isDirectory
  const noPlatform = valid && check.platforms.length === 0

  async function open(path: string) {
    setSubmitting(true)
    const success = await selectWorkspace(path)
    setSubmitting(false)
    if (success) setValue("")
  }

  async function removeRecent(path: string) {
    try {
      await apiFetch("/api/workspace", {
        method: "DELETE",
        body: JSON.stringify({ path }),
      })
    } finally {
      // The provider refreshes recents on next select; force a soft reload.
      window.location.reload()
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Choose the project folder BlackAgents manages.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace</CardTitle>
          <CardDescription>
            Enter the absolute path to a project (a folder containing a{" "}
            <code className="rounded bg-muted px-1">.cursor</code> or{" "}
            <code className="rounded bg-muted px-1">.claude</code> directory).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-path">Project path</Label>
            <div className="flex gap-2">
              <Input
                id="workspace-path"
                placeholder="/Users/you/Dev/my-project"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                disabled={!valid || submitting}
                onClick={() => open(check!.path ?? value.trim())}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="h-4 w-4" />
                )}
                Open
              </Button>
            </div>

            {value.trim() ? (
              <div className="flex items-center gap-2 text-xs">
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
                {valid && check
                  ? check.platforms.map((p) => (
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
              </div>
            ) : null}
          </div>

          {workspace ? (
            <>
              <Separator />
              <div className="text-sm">
                <span className="text-muted-foreground">Active workspace: </span>
                <span className="font-medium">{workspace.name}</span>
                <p className="truncate text-xs text-muted-foreground">
                  {workspace.path}
                </p>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {recents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent workspaces</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {recents.map((ws) => (
              <div
                key={ws.path}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted",
                  workspace?.path === ws.path && "bg-muted"
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => open(ws.path)}
                >
                  <p className="truncate text-sm font-medium">{ws.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ws.path}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Remove from recents"
                  onClick={() => removeRecent(ws.path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
