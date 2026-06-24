"use client"

import * as React from "react"
import JSZip from "jszip"
import {
  Download,
  FileArchive,
  FileOutput,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import { PLATFORM_LAYOUTS } from "@/lib/artifacts/layout"
import type { Platform } from "@/lib/artifacts/types"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ExportStatus = "create" | "overwrite" | "unchanged"

interface ExportFile {
  path: string
  content: string
}

interface FileResult {
  path: string
  status: ExportStatus
  applied: boolean
}

interface ExportResult {
  platform: Platform
  mode: "dry-run" | "write"
  overwrite: boolean
  summary: {
    total: number
    create: number
    overwrite: number
    unchanged: number
    written: number
  }
  files: FileResult[]
}

const PLATFORM_OPTIONS = (Object.keys(PLATFORM_LAYOUTS) as Platform[]).map(
  (id) => ({ id, label: PLATFORM_LAYOUTS[id].label })
)

const STATUS_STYLE: Record<ExportStatus, string> = {
  create: "border-transparent bg-skill/15 text-skill",
  overwrite: "border-transparent bg-rule/15 text-rule",
  unchanged: "text-muted-foreground",
}

const STATUS_DESCRIPTION: Record<ExportStatus, string> = {
  create:
    "This file doesn't exist in the destination yet — it will be created on export.",
  overwrite:
    "A file already exists and differs from the canonical artifact — it will be overwritten, but only while \u201cOverwrite changed files\u201d is on.",
  unchanged:
    "The destination file already matches the canonical artifact — it is skipped and never rewritten.",
}

export function ExportPage() {
  const { workspace } = useWorkspace()
  const [platform, setPlatform] = React.useState<Platform>("claude")
  const [overwrite, setOverwrite] = React.useState(true)
  const [target, setTarget] = React.useState("")
  const [targetCheck, setTargetCheck] = React.useState<{
    exists: boolean
    isDirectory: boolean
  } | null>(null)
  const [targetChecking, setTargetChecking] = React.useState(false)
  const [appliedTarget, setAppliedTarget] = React.useState("")
  const [result, setResult] = React.useState<ExportResult | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [writing, setWriting] = React.useState(false)
  const [zipping, setZipping] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const targetValid =
    !target.trim() || Boolean(targetCheck?.exists && targetCheck.isDirectory)

  React.useEffect(() => {
    const t = target.trim()
    if (!t) {
      setTargetCheck(null)
      setAppliedTarget("")
      return
    }
    setTargetChecking(true)
    const handle = setTimeout(async () => {
      try {
        const r = await apiFetch<{
          exists: boolean
          isDirectory: boolean
          path?: string
        }>(`/api/workspace/check?path=${encodeURIComponent(t)}`)
        setTargetCheck(r)
        if (r.exists && r.isDirectory) setAppliedTarget(r.path ?? t)
      } catch {
        setTargetCheck(null)
      } finally {
        setTargetChecking(false)
      }
    }, 350)
    return () => clearTimeout(handle)
  }, [target])

  const preview = React.useCallback(async () => {
    setPreviewing(true)
    try {
      const data = await apiFetch<ExportResult>("/api/export", {
        method: "POST",
        body: JSON.stringify({
          platform,
          mode: "dry-run",
          targetPath: appliedTarget || undefined,
        }),
      })
      setResult(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed")
      setResult(null)
    } finally {
      setPreviewing(false)
    }
  }, [platform, appliedTarget])

  React.useEffect(() => {
    if (workspace) void preview()
  }, [workspace, preview])

  async function downloadZip() {
    if (!workspace) return
    setZipping(true)
    try {
      const data = await apiFetch<{ platform: Platform; files: ExportFile[] }>(
        `/api/export?platform=${platform}`
      )
      if (data.files.length === 0) {
        toast.info("Nothing to export in this workspace.")
        return
      }
      const zip = new JSZip()
      for (const file of data.files) zip.file(file.path, file.content)
      const blob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${workspace.name}-${platform}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${data.files.length} file(s) as .zip`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build archive")
    } finally {
      setZipping(false)
    }
  }

  async function write() {
    setWriting(true)
    try {
      const data = await apiFetch<ExportResult>("/api/export", {
        method: "POST",
        body: JSON.stringify({
          platform,
          mode: "write",
          overwrite,
          targetPath: appliedTarget || undefined,
        }),
      })
      setResult(data)
      toast.success(
        `Exported to ${PLATFORM_LAYOUTS[platform].label}: ${data.summary.written} file(s) written`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    } finally {
      setWriting(false)
      setConfirmOpen(false)
    }
  }

  if (!workspace) {
    return <NoWorkspace message="Select a workspace to export its artifacts." />
  }

  const summary = result?.summary
  const changes = summary ? summary.create + summary.overwrite : 0
  const willWrite = overwrite ? changes : summary?.create ?? 0
  const destLabel = appliedTarget || `${workspace.name} (active workspace)`

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Export</h1>
        <p className="text-sm text-muted-foreground">
          Re-emit <span className="font-medium">{workspace.name}</span>&rsquo;s
          artifacts in another platform&rsquo;s layout.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target platform</CardTitle>
          <CardDescription>
            Files land under{" "}
            <code className="rounded bg-muted px-1">
              {PLATFORM_LAYOUTS[platform].root}/
            </code>{" "}
            in the destination folder. Rule activation and frontmatter keys are
            translated per platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as Platform)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 pb-1.5">
              <Switch
                id="overwrite"
                checked={overwrite}
                onCheckedChange={setOverwrite}
              />
              <Label htmlFor="overwrite" className="font-normal">
                Overwrite changed files
              </Label>
            </div>

            <Button
              variant="outline"
              className="ml-auto"
              onClick={() => preview()}
              disabled={previewing || !targetValid}
            >
              <RefreshCw className={cn("h-4 w-4", previewing && "animate-spin")} />
              Refresh preview
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-path" className="font-normal">
              Write into{" "}
              <span className="text-muted-foreground">
                (optional — defaults to the active workspace)
              </span>
            </Label>
            <Input
              id="target-path"
              placeholder={workspace.path}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {target.trim() ? (
              <p className="text-xs">
                {targetChecking ? (
                  <span className="text-muted-foreground">Checking…</span>
                ) : targetValid ? (
                  <span className="text-skill">
                    Cross-repo export → bundle written into this folder.
                  </span>
                ) : (
                  <span className="text-destructive">Not a directory.</span>
                )}
              </p>
            ) : null}
          </div>

          {summary ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={cn("cursor-default", STATUS_STYLE.create)}
                  >
                    {summary.create} new
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {STATUS_DESCRIPTION.create}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={cn("cursor-default", STATUS_STYLE.overwrite)}
                  >
                    {summary.overwrite} changed
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {STATUS_DESCRIPTION.overwrite}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-default">
                    {summary.unchanged} unchanged
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {STATUS_DESCRIPTION.unchanged}
                </TooltipContent>
              </Tooltip>
              <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                {summary.total} files total
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              {result?.mode === "write"
                ? "Last export result."
                : "What would be written. Nothing is changed until you export."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!summary || summary.total === 0 || zipping}
              onClick={downloadZip}
            >
              {zipping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileArchive className="h-4 w-4" />
              )}
              Download .zip
            </Button>
            <Button
              disabled={!summary || willWrite === 0 || writing || !targetValid}
              onClick={() => setConfirmOpen(true)}
            >
              {writing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileOutput className="h-4 w-4" />
              )}
              Export {willWrite > 0 ? `(${willWrite})` : ""}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {previewing && !result ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Building preview…
            </p>
          ) : result && result.files.length > 0 ? (
            <div className="max-h-[28rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.files.map((f) => (
                    <TableRow key={f.path}>
                      <TableCell className="font-mono text-xs">
                        {f.path}
                        {f.applied ? (
                          <span className="ml-2 text-skill">written</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No artifacts to export in this workspace.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export to {PLATFORM_LAYOUTS[platform].label}?
            </DialogTitle>
            <DialogDescription>
              This writes {willWrite} file(s) into{" "}
              <span className="font-medium">{destLabel}</span>
              {summary && summary.overwrite > 0 && overwrite
                ? `, overwriting ${summary.overwrite} existing file(s).`
                : "."}{" "}
              This action modifies files on disk.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={write} disabled={writing}>
              {writing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Write files
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
