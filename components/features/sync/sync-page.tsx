"use client"

import * as React from "react"
import {
  ArrowDownToLine,
  CircleCheck,
  FolderInput,
  GitCompare,
  Info,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import type { DriftReport, PlatformDrift } from "@/lib/artifacts/drift"
import { PLATFORM_LAYOUTS } from "@/lib/artifacts/layout"
import {
  ideOnlySummary,
  platformFolder,
  PLATFORM_ORDER,
  SOURCE_HELP,
  STATUS_HELP,
  STATUS_LABEL,
  targetsSummary,
  type SyncStatus,
} from "@/lib/artifacts/sync-explain"
import type { Platform } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const STATUS_STYLE: Record<SyncStatus, string> = {
  "in-sync": "text-muted-foreground",
  drifted: "border-transparent bg-rule/15 text-rule",
  missing: "border-transparent bg-skill/15 text-skill",
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function filesWord(count: number): string {
  return count === 1 ? "1 file" : `${count} files`
}

function StatusBadge({ status, count }: { status: SyncStatus; count?: number }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("cursor-default text-[11px]", STATUS_STYLE[status])}>
          {count === undefined ? STATUS_LABEL[status] : `${count} ${STATUS_LABEL[status]}`}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{STATUS_HELP[status]}</TooltipContent>
    </Tooltip>
  )
}

export function SyncPage(): React.ReactElement {
  const { workspace, refresh } = useWorkspace()
  const [report, setReport] = React.useState<DriftReport | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setReport(await apiFetch<DriftReport>("/api/drift"))
    } catch (err) {
      toast.error(errorText(err, "Could not compare the folders"))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (workspace) void load()
  }, [workspace, load])

  async function run(key: string, action: () => Promise<string>): Promise<void> {
    setBusy(key)
    try {
      toast.success(await action())
      await Promise.all([load(), refresh()])
    } catch (err) {
      toast.error(errorText(err, "Something went wrong"))
    } finally {
      setBusy(null)
    }
  }

  function setTarget(platform: Platform, on: boolean): void {
    if (!report) return
    const targets = on ? [...report.targets, platform] : report.targets.filter((p) => p !== platform)
    void run(`target:${platform}`, async () => {
      const res = await apiFetch<{ written: string[] }>("/api/artifacts/targets", {
        method: "PUT",
        body: JSON.stringify({ targets }),
      })
      const label = PLATFORM_LAYOUTS[platform].label
      return on ? `${label} turned on. Exported ${filesWord(res.written.length)}.` : `${label} turned off.`
    })
  }

  function exportNow(ids?: string[]): void {
    void run(ids ? `export:${ids.join(",")}` : "export", async () => {
      const res = await apiFetch<{ written: string[] }>("/api/artifacts/sync", {
        method: "POST",
        body: JSON.stringify({ action: "export", ids }),
      })
      return res.written.length > 0 ? `Exported ${filesWord(res.written.length)}.` : "Everything was already up to date."
    })
  }

  function importAll(): void {
    void run("import", async () => {
      const res = await apiFetch<{ imported: string[] }>("/api/artifacts/sync", {
        method: "POST",
        body: JSON.stringify({ action: "import" }),
      })
      return `Moved ${res.imported.length} into BlackAgents.`
    })
  }

  function keepIdeVersion(platform: PlatformDrift, id: string): void {
    const [type, name] = id.split(":")
    void run(`keep:${platform.platform}:${id}`, async () => {
      await apiFetch("/api/artifacts/sync", {
        method: "POST",
        body: JSON.stringify({ action: "import", only: { platform: platform.platform, type, name } }),
      })
      return `Kept the ${platform.label} version of ${name}.`
    })
  }

  if (!workspace) {
    return <NoWorkspace message="Select a workspace to sync its artifacts." />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sync</h1>
          <p className="text-sm text-muted-foreground">
            Keep <span className="font-medium">{workspace.name}</span>&apos;s IDE folders up to date.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button onClick={() => exportNow()} disabled={!report || busy !== null || report.sourceCount === 0}>
            {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Export now
          </Button>
        </div>
      </div>

      <section
        aria-label="How sync works"
        className="flex gap-3 rounded-lg border bg-muted/40 p-4 text-sm"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="text-muted-foreground">{SOURCE_HELP}</p>
      </section>

      {loading && !report ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Comparing folders…
        </p>
      ) : report ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export on save</CardTitle>
              <CardDescription>{targetsSummary(report.targets, report.targetsSaved)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {PLATFORM_ORDER.map((platform) => {
                const on = report.targets.includes(platform)
                const id = `target-${platform}`
                return (
                  <label
                    key={platform}
                    htmlFor={id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{PLATFORM_LAYOUTS[platform].label}</span>
                      <code className="text-xs text-muted-foreground">{platformFolder(platform)}</code>
                    </span>
                    <Switch
                      id={id}
                      checked={on}
                      disabled={busy !== null}
                      aria-label={`Export to ${PLATFORM_LAYOUTS[platform].label}`}
                      onCheckedChange={(value) => setTarget(platform, value)}
                    />
                  </label>
                )
              })}
            </CardContent>
          </Card>

          {report.ideOnly.length > 0 ? (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FolderInput className="h-4 w-4 text-rule" aria-hidden />
                    Only in IDE folders
                  </CardTitle>
                  <CardDescription>{ideOnlySummary(report.ideOnly.length)}</CardDescription>
                </div>
                <Button size="sm" onClick={importAll} disabled={busy !== null}>
                  {busy === "import" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-4 w-4" />
                  )}
                  Move into BlackAgents
                </Button>
              </CardHeader>
              <CardContent>
                <ul aria-label="Only in IDE folders" className="space-y-1">
                  {report.ideOnly.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm">
                      <Badge variant="outline" className="text-[11px]">
                        {metaForType(item.type).label}
                      </Badge>
                      <span className="font-medium">{item.name}</span>
                      <code className="truncate text-xs text-muted-foreground">{item.path}</code>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {report.platforms.map((p) => {
            // With export off, a missing copy is expected; only hand edits matter.
            const outOfSync = p.files.filter((f) => (p.target ? f.status !== "in-sync" : f.status === "drifted"))
            const clean = outOfSync.length === 0
            return (
              <Card key={p.platform} aria-label={`${p.label} folder`}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {clean ? (
                        <CircleCheck className="h-4 w-4 text-primary" aria-hidden />
                      ) : (
                        <GitCompare className="h-4 w-4 text-rule" aria-hidden />
                      )}
                      {p.label}
                      {!p.target ? (
                        <Badge variant="outline" className="text-[11px] font-normal">
                          export off
                        </Badge>
                      ) : null}
                    </CardTitle>
                    <CardDescription>
                      {p.summary.total === 0
                        ? "Nothing in BlackAgents to compare yet."
                        : !p.target && clean
                          ? "Export is off for this folder. Turn it on above to keep it up to date."
                          : clean
                          ? "Matches BlackAgents."
                          : `${outOfSync.length} of ${p.summary.total} need attention.`}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <StatusBadge status="missing" count={p.summary.missing} />
                    <StatusBadge status="drifted" count={p.summary.drifted} />
                    <StatusBadge status="in-sync" count={p.summary["in-sync"]} />
                  </div>
                </CardHeader>
                {!clean ? (
                  <CardContent>
                    <ul className="space-y-1">
                      {outOfSync.map((f) => (
                        <li
                          key={f.id}
                          className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                        >
                          <StatusBadge status={f.status} />
                          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{f.path}</code>
                          {f.status === "drifted" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() => keepIdeVersion(p, f.id)}
                            >
                              Keep this change
                            </Button>
                          ) : null}
                          {p.target ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => exportNow([f.id])}
                            >
                              {f.status === "drifted" ? "Overwrite" : "Export"}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                ) : null}
              </Card>
            )
          })}
        </>
      ) : null}
    </div>
  )
}
