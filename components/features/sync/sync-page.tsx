"use client"

import * as React from "react"
import Link from "next/link"
import { CircleCheck, GitCompare, Loader2, RefreshCw } from "lucide-react"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ArtifactType } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type DriftStatus = "in-sync" | "drifted" | "missing"

interface DriftFile {
  id: string
  name: string
  type: ArtifactType
  path: string
  status: DriftStatus
}

interface PlatformDrift {
  platform: string
  label: string
  summary: { total: number; "in-sync": number; drifted: number; missing: number }
  files: DriftFile[]
}

const STATUS_STYLE: Record<DriftStatus, string> = {
  "in-sync": "text-muted-foreground",
  drifted: "border-transparent bg-rule/15 text-rule",
  missing: "border-transparent bg-skill/15 text-skill",
}

const STATUS_DESCRIPTION: Record<DriftStatus, string> = {
  "in-sync":
    "The on-disk file matches the canonical artifact — same managed frontmatter and body (formatting and extra keys are ignored).",
  drifted:
    "The file exists, but its body or one of the managed frontmatter keys has diverged from the canonical artifact. Resolve in Export to overwrite it.",
  missing:
    "No file exists for this artifact on this platform yet. Export to create it.",
}

export function SyncPage() {
  const { workspace } = useWorkspace()
  const [platforms, setPlatforms] = React.useState<PlatformDrift[] | null>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ platforms: PlatformDrift[] }>("/api/drift")
      setPlatforms(data.platforms)
    } catch {
      setPlatforms([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (workspace) void load()
  }, [workspace, load])

  if (!workspace) {
    return <NoWorkspace message="Select a workspace to check platform drift." />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
          <p className="text-sm text-muted-foreground">
            How each platform present in{" "}
            <span className="font-medium">{workspace.name}</span> compares to the
            canonical artifacts.
          </p>
        </div>
        <Button variant="outline" onClick={() => load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading && !platforms ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Comparing platforms…
        </p>
      ) : platforms && platforms.length > 0 ? (
        platforms.map((p) => {
          const outOfSync = p.files.filter((f) => f.status !== "in-sync")
          const clean = outOfSync.length === 0
          return (
            <Card key={p.platform}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {clean ? (
                      <CircleCheck className="h-4 w-4 text-primary" />
                    ) : (
                      <GitCompare className="h-4 w-4 text-rule" />
                    )}
                    {p.label}
                  </CardTitle>
                  <CardDescription>
                    {clean
                      ? "All artifacts are in sync."
                      : `${outOfSync.length} of ${p.summary.total} out of sync.`}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className={cn("cursor-default", STATUS_STYLE.missing)}
                      >
                        {p.summary.missing} missing
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {STATUS_DESCRIPTION.missing}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className={cn("cursor-default", STATUS_STYLE.drifted)}
                      >
                        {p.summary.drifted} drifted
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {STATUS_DESCRIPTION.drifted}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="cursor-default">
                        {p.summary["in-sync"]} in sync
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {STATUS_DESCRIPTION["in-sync"]}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardHeader>
              {!clean ? (
                <CardContent className="space-y-1">
                  {outOfSync.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className={cn(
                              "cursor-default text-[11px]",
                              STATUS_STYLE[f.status]
                            )}
                          >
                            {f.status}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {STATUS_DESCRIPTION[f.status]}
                        </TooltipContent>
                      </Tooltip>
                      <span className="font-mono text-xs text-muted-foreground">
                        {f.path}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/export">
                        <GitCompare className="h-4 w-4" />
                        Resolve in Export
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          )
        })
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No platform directories detected in this workspace.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
