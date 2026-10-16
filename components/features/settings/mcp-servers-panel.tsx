"use client"

import * as React from "react"
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Terminal,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { McpEnvRow } from "@/lib/mcp/env"
import type { McpHeaderRow } from "@/lib/mcp/headers"
import type { McpTrust } from "@/lib/mcp/policy"
import { isFullSecretRef, mcpSecretId } from "@/lib/mcp/secret-refs"
import type { McpSecretStatus, McpServerConfig, McpServerStatus, McpTransportType } from "@/lib/mcp/types"
import {
  buildMcpSaveBody,
  draftFromServer,
  emptyMcpDraft,
  isMcpDraftDirty,
  mcpTestErrorAllowsSave,
  readMcpConnection,
  type McpFormDraft,
  type McpStoredSecrets,
} from "@/lib/settings/mcp-form"
import {
  ACTION,
  deleteServerEffect,
  deleteServerLabel,
  deleteServerTitle,
  editServerLabel,
  EMPTY,
  ENV_SECRET_HELP,
  HEADER_SECRET_HELP,
  keptSecretPlaceholder,
  MCP_LOAD_ERROR,
  MCP_WHERE,
  mcpSaveFeedback,
  NAME_FIXED_HELP,
  SAVE_OR_CANCEL,
  SECRET_KEEP_HELP,
  TERM_TRUST,
  transportHelp,
  UNSAVED_CHANGES,
} from "@/lib/settings/explain"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { McpTrustSelect } from "@/components/features/settings/mcp-trust-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

interface McpListResponse {
  servers: Array<McpServerStatus & { trust: McpTrust }>
  totalTools: number
}

interface EditState {
  name: string
  disabled: boolean
  stored: McpStoredSecrets
  secretStatuses?: Record<string, McpSecretStatus>
}

interface StatusView {
  tone: "ok" | "error"
  detail: string
}

const TEST_PATH = "/api/mcp/test"

function remoteLabel(config: McpServerConfig): string {
  if (config.transport === "sse") return "SSE "
  if (config.transport === "http" || Boolean(config.url)) return "HTTP "
  return ""
}

function storedMark(
  serverName: string,
  kind: "header" | "env",
  key: string,
  secretStatuses: Record<string, McpSecretStatus> | undefined
): string | null {
  const status = secretStatuses?.[mcpSecretId(serverName, kind, key)]
  if (!status?.configured) return null
  return status.last4 ? `••••${status.last4}` : "stored"
}

function valuePlaceholder(
  editing: EditState | null,
  kind: "header" | "env",
  key: string,
  fallback: string
): string {
  if (!editing) return fallback
  const stored = (kind === "header" ? editing.stored.headers : editing.stored.env)?.[key.trim()]
  if (!stored || !isFullSecretRef(stored)) return fallback
  const status = editing.secretStatuses?.[mcpSecretId(editing.name, kind, key.trim())]
  return keptSecretPlaceholder(status?.last4)
}

export function McpServersPanel({
  onToolCount,
}: {
  onToolCount?: (count: number) => void
}): React.ReactElement {
  const { workspace } = useWorkspace()
  const workspacePath = workspace?.path ?? null
  const onToolCountRef = React.useRef(onToolCount)
  onToolCountRef.current = onToolCount
  const [servers, setServers] = React.useState<McpListResponse["servers"]>([])
  const [loading, setLoading] = React.useState(true)
  const [loaded, setLoaded] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expandedServer, setExpandedServer] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<McpFormDraft>(emptyMcpDraft)
  const [baseline, setBaseline] = React.useState<McpFormDraft>(emptyMcpDraft)
  const [editing, setEditing] = React.useState<EditState | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const [lastStatus, setLastStatus] = React.useState<StatusView | null>(null)
  const formTitleRef = React.useRef<HTMLDivElement>(null)
  const dirty = isMcpDraftDirty(draft, baseline)

  const load = React.useCallback(async (): Promise<void> => {
    if (!workspacePath) {
      setServers([])
      setLoaded(false)
      setError(null)
      setLoading(false)
      onToolCountRef.current?.(0)
      return
    }
    setLoading(true)
    try {
      const res = await apiFetch<McpListResponse>("/api/mcp")
      setServers(res.servers)
      setLoaded(true)
      setError(null)
      onToolCountRef.current?.(res.totalTools)
    } catch (err) {
      setError(err instanceof Error ? err.message : MCP_LOAD_ERROR)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  React.useEffect(() => {
    const empty = emptyMcpDraft()
    setDraft(empty)
    setBaseline(empty)
    setEditing(null)
    setLastStatus(null)
    setPendingDelete(null)
    setLoaded(false)
    setServers([])
    setError(null)
    void load()
  }, [load])

  React.useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function updateDraft(next: McpFormDraft): void {
    setLastStatus(null)
    setDraft(next)
  }

  function resetToAdd(): void {
    const empty = emptyMcpDraft()
    setDraft(empty)
    setBaseline(empty)
    setEditing(null)
  }

  function startEdit(server: McpListResponse["servers"][number]): void {
    if (editing?.name === server.name) {
      formTitleRef.current?.focus()
      return
    }
    if (dirty) {
      toast.error(SAVE_OR_CANCEL)
      return
    }
    const next = draftFromServer(server.name, server.config)
    setDraft(next)
    setBaseline(next)
    setEditing({
      name: server.name,
      disabled: Boolean(server.config.disabled),
      stored: {
        headers: server.config.headers ?? {},
        env: server.config.env ?? {},
      },
      secretStatuses: server.secretStatuses,
    })
    setLastStatus(null)
    requestAnimationFrame(() => {
      formTitleRef.current?.focus()
      document.getElementById("mcp-server-form")?.scrollIntoView({ block: "nearest" })
    })
  }

  async function handleSave(): Promise<void> {
    const built = buildMcpSaveBody(editing ? { ...draft, name: editing.name } : draft, editing?.stored ?? null, {
      disabled: Boolean(editing?.disabled),
    })
    if (!built.ok) {
      toast.error(built.error)
      return
    }

    setSaving(true)
    try {
      let tested: ReturnType<typeof readMcpConnection> = null
      try {
        const testResult = await apiFetch<unknown>(TEST_PATH, {
          method: "POST",
          body: JSON.stringify(built.body),
        })
        tested = readMcpConnection(testResult)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not test the server"
        if (!mcpTestErrorAllowsSave(message)) {
          setLastStatus({ tone: "error", detail: message })
          toast.error(message)
          return
        }
      }

      const saved = await apiFetch<unknown>("/api/mcp", {
        method: "POST",
        body: JSON.stringify(built.body),
      })
      const connection = readMcpConnection(saved) ?? tested
      if (connection) {
        const feedback = mcpSaveFeedback(connection)
        setLastStatus({ tone: feedback.tone, detail: feedback.detail })
        if (feedback.tone === "error") toast.error(feedback.toast)
        else toast.success(feedback.toast)
      } else {
        toast.success(editing ? `Updated MCP server "${built.body.name}"` : `Configured MCP server "${built.body.name}"`)
      }
      resetToAdd()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to configure MCP server")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(name: string): Promise<void> {
    setDeleting(name)
    try {
      await apiFetch(`/api/mcp?name=${encodeURIComponent(name)}`, { method: "DELETE" })
      toast.success(`Removed MCP server "${name}"`)
      if (editing?.name === name) resetToAdd()
      setPendingDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove MCP server")
    } finally {
      setDeleting(null)
    }
  }

  if (!workspace) {
    return (
      <Card>
        <CardContent className="space-y-2 py-8 text-center">
          <p className="text-sm font-medium">No active workspace</p>
          <p className="text-sm text-muted-foreground">{EMPTY.noWorkspaceMcp}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plug className="h-4 w-4 text-primary" />
                Active Workspace MCP Servers
              </CardTitle>
              <CardDescription>
                {MCP_WHERE} {TERM_TRUST}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              className="gap-1.5"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="relative space-y-3">
          {loading && !loaded ? (
            <div className="space-y-2" aria-busy="true">
              <p className="text-sm text-muted-foreground">Loading servers…</p>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="flex items-center justify-between gap-3 text-sm">
              <span className="text-destructive">{error}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}

          {loaded && !error && servers.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-sm font-medium">{EMPTY.mcpTitle}</p>
              <p className="text-sm text-muted-foreground">{EMPTY.mcpText}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  document.getElementById("mcp-server-form")?.scrollIntoView({ block: "nearest" })
                  document.getElementById("mcp-name")?.focus()
                }}
              >
                {EMPTY.mcpAction}
              </Button>
            </div>
          ) : null}

          {loaded
            ? servers.map((server) => {
                const isExpanded = expandedServer === server.name
                const headerNames = Object.keys(server.config.headers ?? {})
                const envNames = Object.keys(server.config.env ?? {})
                return (
                  <div
                    key={server.name}
                    className={cn(
                      "space-y-2 rounded-lg border bg-card p-3 transition-colors",
                      editing?.name === server.name && "border-primary"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-semibold">{server.name}</span>
                        <Badge
                          variant={
                            server.status === "connected"
                              ? "default"
                              : server.status === "disabled"
                                ? "secondary"
                                : "destructive"
                          }
                          className="px-1.5 py-0 text-[10px]"
                        >
                          {server.status === "connected" ? `${server.tools.length} tools active` : server.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <McpTrustSelect server={server.name} value={server.trust} />
                        {server.tools.length > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedServer(isExpanded ? null : server.name)}
                            className="h-7 gap-1 px-2 text-xs"
                          >
                            Tools
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          aria-label={editServerLabel(server.name)}
                          onClick={() => startEdit(server)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={deleting === server.name}
                          aria-label={deleteServerLabel(server.name)}
                          onClick={() => setPendingDelete(server.name)}
                        >
                          {deleting === server.name ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1 rounded bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
                      <p>
                        <span className="font-sans">{remoteLabel(server.config)}</span>
                        {server.config.command ? (
                          <span>
                            {server.config.command} {(server.config.args ?? []).join(" ")}
                          </span>
                        ) : (
                          <span>{server.config.url}</span>
                        )}
                      </p>
                      {headerNames.length > 0 ? (
                        <p className="font-sans">
                          Headers:{" "}
                          {headerNames
                            .map((header) => {
                              const hint = storedMark(server.name, "header", header, server.secretStatuses)
                              return hint ? `${header} (${hint})` : header
                            })
                            .join(", ")}
                        </p>
                      ) : null}
                      {envNames.length > 0 ? (
                        <p className="font-sans">
                          Secrets:{" "}
                          {envNames
                            .map((key) => {
                              const hint = storedMark(server.name, "env", key, server.secretStatuses)
                              return hint ? `${key} (${hint})` : key
                            })
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>

                    {server.error ? (
                      <p className="flex items-center gap-1 text-xs text-destructive">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        {server.error}
                      </p>
                    ) : null}

                    {isExpanded && server.tools.length > 0 ? (
                      <div className="space-y-1.5 border-t pt-2">
                        <p className="text-xs font-medium text-muted-foreground">Provided Tools:</p>
                        <div className="grid grid-cols-1 gap-1">
                          {server.tools.map((tool) => (
                            <div
                              key={tool.name}
                              className="flex flex-col gap-0.5 rounded border bg-background p-1.5 font-mono text-xs"
                            >
                              <span className="font-semibold text-primary">{tool.name}</span>
                              {tool.description ? (
                                <span className="font-sans text-[11px] text-muted-foreground">{tool.description}</span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })
            : null}
        </CardContent>
      </Card>

      <Card id="mcp-server-form" className="scroll-mt-6">
        <CardHeader>
          <CardTitle ref={formTitleRef} tabIndex={-1} className="flex items-center gap-2 text-base">
            {editing ? `Edit ${editing.name}` : "Add an MCP Server"}
            {dirty ? <span className="text-xs font-normal text-muted-foreground">{UNSAVED_CHANGES}</span> : null}
          </CardTitle>
          <CardDescription>
            {editing
              ? "Change the command, URL, or secrets, then save."
              : "Add a local command, an HTTP server (POST), or an old SSE server."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mcp-name">Server Name</Label>
              <Input
                id="mcp-name"
                placeholder="e.g. crypto-tools, fetch, github"
                value={draft.name}
                onChange={(event) => updateDraft({ ...draft, name: event.target.value })}
                spellCheck={false}
                disabled={Boolean(editing)}
                aria-describedby={editing ? "mcp-name-fixed" : undefined}
              />
              {editing ? (
                <p id="mcp-name-fixed" className="text-xs text-muted-foreground">
                  {NAME_FIXED_HELP}
                </p>
              ) : null}
            </div>
            <TransportField
              value={draft.transport}
              onChange={(transport) => updateDraft({ ...draft, transport })}
            />
          </div>

          {draft.transport === "stdio" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="mcp-command">Command</Label>
                  <Input
                    id="mcp-command"
                    placeholder="e.g. npx, node, python3"
                    value={draft.command}
                    onChange={(event) => updateDraft({ ...draft, command: event.target.value })}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">{transportHelp("stdio")}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mcp-args">Arguments (space-separated)</Label>
                  <Input
                    id="mcp-args"
                    placeholder="e.g. -y crypto-mcp-server --port 8080"
                    value={draft.args}
                    onChange={(event) => updateDraft({ ...draft, args: event.target.value })}
                    spellCheck={false}
                  />
                </div>
              </div>
              <SecretRows
                label="Secrets"
                addLabel="Add secret"
                removePrefix="Remove secret"
                fieldPrefix="Secret"
                namePlaceholder="GITHUB_TOKEN"
                fallbackPlaceholder="ghp_… or other token"
                help={ENV_SECRET_HELP}
                keepHelp={editing ? SECRET_KEEP_HELP : null}
                rows={draft.env}
                kind="env"
                editing={editing}
                onChange={(env) => updateDraft({ ...draft, env })}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mcp-url">{draft.transport === "http" ? "Server URL" : "Server URL (SSE)"}</Label>
                <Input
                  id="mcp-url"
                  placeholder={draft.transport === "http" ? "https://your-app/api/mcp" : "https://mcp.example.com/sse"}
                  value={draft.url}
                  onChange={(event) => updateDraft({ ...draft, url: event.target.value })}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">{transportHelp(draft.transport)}</p>
              </div>
              <SecretRows
                label="Headers"
                addLabel="Add header"
                removePrefix="Remove header"
                fieldPrefix="Header"
                namePlaceholder="Authorization"
                fallbackPlaceholder="Bearer ghp_… or other token"
                help={HEADER_SECRET_HELP}
                keepHelp={editing ? SECRET_KEEP_HELP : null}
                rows={draft.headers}
                kind="header"
                editing={editing}
                onChange={(headers) => updateDraft({ ...draft, headers })}
              />
            </div>
          )}

          {lastStatus ? (
            <p role="status" className={lastStatus.tone === "error" ? "text-sm text-destructive" : "text-sm text-foreground"}>
              {lastStatus.detail}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">{editing ? ACTION.saveChanges : ACTION.testAndSave}</p>
          {editing || dirty ? (
            <p className="text-xs text-muted-foreground">{editing ? ACTION.cancelEdit : ACTION.cancelAdd}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={saving || (editing ? !dirty : !draft.name.trim())}
              onClick={() => void handleSave()}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              {editing ? "Save changes" : "Test & Save Server"}
            </Button>
            {editing || dirty ? (
              <Button type="button" variant="outline" disabled={saving} onClick={resetToAdd}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingDelete ? deleteServerTitle(pendingDelete) : "Delete server?"}</DialogTitle>
            <DialogDescription>{pendingDelete ? deleteServerEffect(pendingDelete) : null}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={Boolean(deleting)} onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!pendingDelete || Boolean(deleting)}
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete)
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pendingDelete ? deleteServerLabel(pendingDelete) : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TransportField({
  value,
  onChange,
}: {
  value: McpTransportType
  onChange: (transport: McpTransportType) => void
}): React.ReactElement {
  const options: Array<{ id: McpTransportType; label: string }> = [
    { id: "stdio", label: "Command" },
    { id: "http", label: "HTTP" },
    { id: "sse", label: "SSE" },
  ]
  return (
    <div className="space-y-2">
      <Label id="mcp-transport-label">Transport Type</Label>
      <div role="group" aria-labelledby="mcp-transport-label" className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.id}
            type="button"
            variant={value === option.id ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className="flex-1"
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function SecretRows({
  label,
  addLabel,
  removePrefix,
  fieldPrefix,
  namePlaceholder,
  fallbackPlaceholder,
  help,
  keepHelp,
  rows,
  kind,
  editing,
  onChange,
}: {
  label: string
  addLabel: string
  removePrefix: string
  fieldPrefix: string
  namePlaceholder: string
  fallbackPlaceholder: string
  help: string
  keepHelp: string | null
  rows: McpHeaderRow[] | McpEnvRow[]
  kind: "header" | "env"
  editing: EditState | null
  onChange: (rows: McpHeaderRow[]) => void
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { name: "", value: "" }])}>
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
      {keepHelp ? <p className="text-xs text-muted-foreground">{keepHelp}</p> : null}
      {rows.map((row, index) => (
        <div key={`${kind}-${index}`} className="flex gap-2">
          <Input
            className="min-w-0 flex-1"
            aria-label={`${fieldPrefix} ${index + 1} name`}
            placeholder={namePlaceholder}
            value={row.name}
            onChange={(event) =>
              onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item)))
            }
            spellCheck={false}
            autoComplete="off"
          />
          <Input
            className="min-w-0 flex-1"
            type="password"
            aria-label={`${fieldPrefix} ${index + 1} value`}
            placeholder={valuePlaceholder(editing, kind, row.name, fallbackPlaceholder)}
            value={row.value}
            onChange={(event) =>
              onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))
            }
            spellCheck={false}
            autoComplete="new-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`${removePrefix} ${index + 1}`}
            onClick={() => onChange(rows.length === 1 ? [{ name: "", value: "" }] : rows.filter((_, itemIndex) => itemIndex !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}
