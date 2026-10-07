"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Play, Plus, Workflow as WorkflowIcon } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { WorkflowRun } from "@/lib/workflows/schema"
import type { WorkflowListItem } from "@/lib/workflows/service"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { PendingApprovalsPanel } from "./pending-approvals-panel"
import { formatTime, RunStatusBadge, triggerLabel } from "./run-status"

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: WorkflowListItem[] }

export function WorkflowListPage() {
  const router = useRouter()
  const { workspace, loading } = useWorkspace()
  const [state, setState] = React.useState<LoadState>({ kind: "loading" })
  const [starting, setStarting] = React.useState<string | null>(null)

  const load = React.useCallback((): void => {
    apiFetch<{ workflows: WorkflowListItem[] }>("/api/workflows")
      .then((data) => setState({ kind: "ready", items: data.workflows }))
      .catch((err: unknown) =>
        setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load workflows" })
      )
  }, [])

  React.useEffect(() => {
    if (workspace) load()
  }, [workspace, load])

  async function start(name: string) {
    setStarting(name)
    try {
      const { run } = await apiFetch<{ run: WorkflowRun }>(
        `/api/workflows/${encodeURIComponent(name)}/runs`,
        { method: "POST", body: JSON.stringify({}) }
      )
      router.push(`/workflows/runs/${run.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the run")
      setStarting(null)
    }
  }

  if (!workspace && !loading) {
    return <NoWorkspace message="Select a workspace to build agent workflows." />
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <WorkflowIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
            <p className="text-sm text-muted-foreground">
              Agent teams that work like a production line, on this computer.
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/workflows/new">
            <Plus className="h-4 w-4" />
            New workflow
          </Link>
        </Button>
      </div>

      <PendingApprovalsPanel />

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Name</TableHead>
              <TableHead>Steps</TableHead>
              <TableHead className="w-[150px]">Trigger</TableHead>
              <TableHead className="w-[200px]">Last run</TableHead>
              <TableHead className="w-[110px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.kind === "loading" ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading workflows" />
                </TableCell>
              </TableRow>
            ) : state.kind === "error" ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-destructive">
                  {state.message}{" "}
                  <Button variant="link" size="sm" onClick={load}>
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ) : state.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-28 text-center text-sm text-muted-foreground">
                  No workflows yet. Create one and chain your agents.
                </TableCell>
              </TableRow>
            ) : (
              state.items.map(({ workflow, lastRun, active }) => (
                <TableRow
                  key={workflow.name}
                  className="cursor-pointer"
                  onClick={() => router.push(`/workflows/${workflow.name}`)}
                >
                  <TableCell className="font-medium">
                    <span className="line-clamp-1">{workflow.name}</span>
                    {workflow.description ? (
                      <span className="line-clamp-1 text-xs font-normal text-muted-foreground">
                        {workflow.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <span className="line-clamp-1">{workflow.steps.map((s) => s.agent).join(" → ")}</span>
                  </TableCell>
                  <TableCell className="text-sm">{triggerLabel(workflow.trigger)}</TableCell>
                  <TableCell>
                    {lastRun ? (
                      <Link
                        href={`/workflows/runs/${lastRun.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <RunStatusBadge status={lastRun.status} />
                        {formatTime(lastRun.createdAt)}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={active || starting === workflow.name}
                      aria-label={`Run ${workflow.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void start(workflow.name)
                      }}
                    >
                      {starting === workflow.name ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      {active ? "Running" : "Run"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
