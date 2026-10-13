"use client"

import * as React from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Code2,
  Coins,
  FileCode,
  FolderOpen,
  FolderPlus,
  Loader2,
  Plug,
  Plus,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  Wrench,
  Zap,
  Brain,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { WorkspaceTemplate } from "@/lib/artifacts/schemas"
import { WORKSPACE_TEMPLATES } from "@/lib/workspace/templates"
import { collectMcpHeaders, type McpHeaderRow } from "@/lib/mcp/headers"
import type { McpTrust } from "@/lib/mcp/policy"
import { mcpSecretId } from "@/lib/mcp/secret-refs"
import type { McpServerConfig, McpServerStatus, McpTransportType } from "@/lib/mcp/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { AiSettingsCard } from "@/components/features/settings/ai-settings-card"
import { McpTrustSelect } from "@/components/features/settings/mcp-trust-select"
import { TaskModelsCard } from "@/components/features/settings/task-models-card"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface CheckResult {
  exists: boolean
  isDirectory: boolean
  canCreate?: boolean
  path?: string
  platforms: { id: string; label: string }[]
}

interface McpListResponse {
  servers: Array<McpServerStatus & { trust: McpTrust }>
  totalTools: number
}

const TEMPLATE_ICONS: Record<WorkspaceTemplate, React.ComponentType<{ className?: string }>> = {
  crypto: Coins,
  software: Code2,
  blank: FileCode,
}

function remoteLabel(config: McpServerConfig): string {
  if (config.transport === "sse") return "SSE "
  if (config.transport === "http" || Boolean(config.url)) return "HTTP "
  return ""
}

function headerNameList(config: McpServerConfig): string[] {
  return Object.keys(config.headers ?? {})
}

function secretHint(
  serverName: string,
  headerName: string,
  secretStatuses: Record<string, { configured: boolean; last4?: string }> | undefined
): string | null {
  const status = secretStatuses?.[mcpSecretId(serverName, "header", headerName)]
  if (!status?.configured) return null
  return status.last4 ? `••••${status.last4}` : "stored"
}

export function SettingsPage({ initialTab = "create" }: { initialTab?: string }) {
  const {
    workspace,
    workspaces,
    addWorkspace,
    createWorkspace,
    setActive,
    removeWorkspace,
  } = useWorkspace()

  // The server reads `?tab=` and passes the same value to the first client
  // render, avoiding a hydration mismatch on direct links to the AI tab.
  const [tab, setTab] = React.useState(initialTab)

  // "Open Existing" state
  const [openPath, setOpenPath] = React.useState("")
  const [openCheck, setOpenCheck] = React.useState<CheckResult | null>(null)
  const [openChecking, setOpenChecking] = React.useState(false)
  const [adding, setAdding] = React.useState(false)

  // "Create New" state
  const [createPath, setCreatePath] = React.useState("")
  const [selectedTemplate, setSelectedTemplate] = React.useState<WorkspaceTemplate>("crypto")
  const [createCheck, setCreateCheck] = React.useState<CheckResult | null>(null)
  const [createChecking, setCreateChecking] = React.useState(false)
  const [creating, setCreating] = React.useState(false)

  // MCP Servers state
  const [mcpServers, setMcpServers] = React.useState<McpListResponse["servers"]>([])
  const [totalMcpTools, setTotalMcpTools] = React.useState(0)
  const [loadingMcp, setLoadingMcp] = React.useState(false)
  const [expandedServer, setExpandedServer] = React.useState<string | null>(null)

  // Add MCP server form
  const [mcpName, setMcpName] = React.useState("")
  const [mcpType, setMcpType] = React.useState<McpTransportType>("stdio")
  const [mcpCommand, setMcpCommand] = React.useState("")
  const [mcpArgs, setMcpArgs] = React.useState("")
  const [mcpUrl, setMcpUrl] = React.useState("")
  const [mcpHeaders, setMcpHeaders] = React.useState<McpHeaderRow[]>([
    { name: "", value: "" },
  ])
  const [savingMcp, setSavingMcp] = React.useState(false)
  const [deletingMcp, setDeletingMcp] = React.useState<string | null>(null)

  // General busy state
  const [busyPath, setBusyPath] = React.useState<string | null>(null)

  // Load MCP servers when active workspace changes
  const loadMcp = React.useCallback(async () => {
    if (!workspace) {
      setMcpServers([])
      setTotalMcpTools(0)
      return
    }
    setLoadingMcp(true)
    try {
      const res = await apiFetch<McpListResponse>("/api/mcp")
      setMcpServers(res.servers)
      setTotalMcpTools(res.totalTools)
    } catch {
      setMcpServers([])
      setTotalMcpTools(0)
    } finally {
      setLoadingMcp(false)
    }
  }, [workspace])

  React.useEffect(() => {
    void loadMcp()
  }, [loadMcp])

  // Debounced check for "Open Existing"
  React.useEffect(() => {
    const trimmed = openPath.trim()
    if (!trimmed) {
      const timer = setTimeout(() => {
        setOpenCheck(null)
        setOpenChecking(false)
      }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(async () => {
      setOpenChecking(true)
      try {
        const result = await apiFetch<CheckResult>(
          `/api/workspace/check?path=${encodeURIComponent(trimmed)}`
        )
        setOpenCheck(result)
      } catch {
        setOpenCheck(null)
      } finally {
        setOpenChecking(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [openPath])

  // Debounced check for "Create New"
  React.useEffect(() => {
    const trimmed = createPath.trim()
    if (!trimmed) {
      const timer = setTimeout(() => {
        setCreateCheck(null)
        setCreateChecking(false)
      }, 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(async () => {
      setCreateChecking(true)
      try {
        const result = await apiFetch<CheckResult>(
          `/api/workspace/check?path=${encodeURIComponent(trimmed)}`
        )
        setCreateCheck(result)
      } catch {
        setCreateCheck(null)
      } finally {
        setCreateChecking(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [createPath])

  const openValid = Boolean(openCheck?.exists && openCheck.isDirectory)
  const openNoPlatform = openValid && openCheck!.platforms.length === 0
  const openAlreadyAdded =
    openValid &&
    workspaces.some((w) => w.path === (openCheck!.path ?? openPath.trim()))

  async function handleAddExisting() {
    setAdding(true)
    const target = openCheck!.path ?? openPath.trim()
    const okAdded = await addWorkspace(target)
    setAdding(false)
    if (okAdded) {
      setOpenPath("")
      setOpenCheck(null)
    }
  }

  const canCreatePath = Boolean(
    createPath.trim() &&
      (!createCheck?.exists || createCheck?.isDirectory)
  )

  async function handleCreateNew() {
    if (!canCreatePath) return
    setCreating(true)
    const okCreated = await createWorkspace(createPath.trim(), selectedTemplate)
    setCreating(false)
    if (okCreated) {
      setCreatePath("")
      setCreateCheck(null)
    }
  }

  async function handleSaveMcpServer() {
    const name = mcpName.trim()
    if (!name) {
      toast.error("Please provide a server name")
      return
    }
    if (mcpType === "stdio" && !mcpCommand.trim()) {
      toast.error("Command is required for stdio server")
      return
    }
    if (mcpType !== "stdio" && !mcpUrl.trim()) {
      toast.error("URL is required for a remote server")
      return
    }

    const collected =
      mcpType === "stdio" ? { ok: true as const, headers: {} } : collectMcpHeaders(mcpHeaders)
    if (!collected.ok) {
      toast.error(collected.error)
      return
    }

    setSavingMcp(true)
    try {
      const args = mcpArgs
        .split(" ")
        .map((a) => a.trim())
        .filter(Boolean)

      const headerNames = Object.keys(collected.headers)
      const payload = {
        name,
        config: {
          command: mcpType === "stdio" ? mcpCommand.trim() : undefined,
          args: mcpType === "stdio" ? args : undefined,
          url: mcpType === "stdio" ? undefined : mcpUrl.trim(),
          headers: mcpType === "stdio" ? undefined : collected.headers,
          transport: mcpType,
        },
        ...(mcpType !== "stdio" && headerNames.length > 0
          ? { secretHeaders: headerNames }
          : {}),
      }

      await apiFetch("/api/mcp", {
        method: "POST",
        body: JSON.stringify(payload),
      })

      toast.success(`Configured MCP server "${name}"`)
      setMcpName("")
      setMcpCommand("")
      setMcpArgs("")
      setMcpUrl("")
      setMcpHeaders([{ name: "", value: "" }])
      await loadMcp()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to configure MCP server")
    } finally {
      setSavingMcp(false)
    }
  }

  async function handleDeleteMcpServer(name: string) {
    setDeletingMcp(name)
    try {
      await apiFetch(`/api/mcp?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      })
      toast.success(`Removed MCP server "${name}"`)
      await loadMcp()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove MCP server")
    } finally {
      setDeletingMcp(null)
    }
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
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces & Tools</h1>
        <p className="text-sm text-muted-foreground">
          Create workspaces, connect Model Context Protocol (MCP) servers, and manage projects.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="create" className="gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Create Workspace
          </TabsTrigger>
          <TabsTrigger value="open" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Open Existing
          </TabsTrigger>
          <TabsTrigger value="mcp" className="gap-2">
            <Wrench className="h-4 w-4 text-purple-400" />
            MCP Servers
            {totalMcpTools > 0 ? (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {totalMcpTools}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="ai" className="gap-2">
            <Brain className="h-4 w-4 text-primary" />
            AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="space-y-4 pt-2">
          <AiSettingsCard />
          <TaskModelsCard />
        </TabsContent>

        {/* Tab 1: Create New Workspace */}
        <TabsContent value="create" className="space-y-4 pt-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Initialize a new workspace</CardTitle>
              <CardDescription>
                Choose a starter kit and specify a folder. BlackAgents will scaffold the standard
                directory layout and initial artifacts so you can interact with your agents immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Starter Kit</Label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(Object.keys(WORKSPACE_TEMPLATES) as WorkspaceTemplate[]).map((key) => {
                    const tmpl = WORKSPACE_TEMPLATES[key]
                    const Icon = TEMPLATE_ICONS[key]
                    const selected = selectedTemplate === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedTemplate(key)}
                        className={cn(
                          "relative flex flex-col items-start justify-between rounded-lg border p-3 text-left transition-all hover:bg-muted/60",
                          selected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border bg-card"
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-1 mb-2">
                          <div
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-md",
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <Badge
                            variant={selected ? "default" : "secondary"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {tmpl.badge}
                          </Badge>
                        </div>
                        <p className="text-xs font-semibold">{tmpl.name}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                          {tmpl.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-workspace-path">Workspace Location</Label>
                <div className="flex gap-2">
                  <Input
                    id="create-workspace-path"
                    placeholder="~/Dev/my-crypto-hub or /Users/you/Dev/crypto-agents"
                    value={createPath}
                    onChange={(e) => setCreatePath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canCreatePath && !creating) {
                        void handleCreateNew()
                      }
                    }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button
                    disabled={!canCreatePath || creating}
                    onClick={() => void handleCreateNew()}
                    className="shrink-0 gap-1.5"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Create
                  </Button>
                </div>

                {createPath.trim() ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                    {createChecking ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Checking location…
                      </span>
                    ) : createCheck?.exists ? (
                      <span className="flex items-center gap-1 text-amber-500">
                        <CircleCheck className="h-3.5 w-3.5" /> Folder already exists — starter artifacts will be seeded into it.
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <Check className="h-3.5 w-3.5" /> New directory will be created at this location.
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Open Existing Folder */}
        <TabsContent value="open" className="space-y-4 pt-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Open an existing workspace</CardTitle>
              <CardDescription>
                Enter the path to a pre-existing project folder on your machine (e.g. a repo with a{" "}
                <code className="rounded bg-muted px-1">.cursor</code> or{" "}
                <code className="rounded bg-muted px-1">.claude</code> directory).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="open-workspace-path">Project path</Label>
                <div className="flex gap-2">
                  <Input
                    id="open-workspace-path"
                    placeholder="/Users/you/Dev/my-project"
                    value={openPath}
                    onChange={(e) => setOpenPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && openValid && !openAlreadyAdded && !adding) {
                        void handleAddExisting()
                      }
                    }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button
                    disabled={!openValid || openAlreadyAdded || adding}
                    onClick={() => void handleAddExisting()}
                    className="shrink-0 gap-1.5"
                  >
                    {adding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FolderPlus className="h-4 w-4" />
                    )}
                    Open
                  </Button>
                </div>

                {openPath.trim() ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                    {openChecking ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                      </span>
                    ) : openValid ? (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <Check className="h-3.5 w-3.5" /> Valid directory
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-destructive">
                        <TriangleAlert className="h-3.5 w-3.5" /> Not an existing directory
                      </span>
                    )}
                    {openValid
                      ? openCheck!.platforms.map((p) => (
                          <Badge key={p.id} variant="secondary">
                            {p.label}
                          </Badge>
                        ))
                      : null}
                    {openNoPlatform ? (
                      <span className="text-muted-foreground">
                        No .cursor/.claude found — you can still author artifacts in it.
                      </span>
                    ) : null}
                    {openAlreadyAdded ? (
                      <span className="text-muted-foreground">
                        Already in your workspace list.
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Model Context Protocol (MCP) Servers */}
        <TabsContent value="mcp" className="space-y-4 pt-2">
          {!workspace ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Please select or create an active workspace first to manage its MCP servers.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Plug className="h-4 w-4 text-purple-400" />
                        Active Workspace MCP Servers
                      </CardTitle>
                      <CardDescription>
                        Configured in <code className="rounded bg-muted px-1">.black-agents/mcp.json</code>.
                        Auth tokens are stored in{" "}
                        <code className="rounded bg-muted px-1">~/.black-agents/secrets.json</code>, not
                        the workspace file. Tools from these servers are available to agent personas in Chat.
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadMcp()}
                      disabled={loadingMcp}
                      className="gap-1.5"
                    >
                      {loadingMcp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mcpServers.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No MCP servers configured in this workspace. Add one below to provide live tools to your agents.
                    </p>
                  ) : (
                    mcpServers.map((s) => {
                      const isExpanded = expandedServer === s.name
                      return (
                        <div
                          key={s.name}
                          className="rounded-lg border bg-card p-3 space-y-2 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-semibold text-sm truncate">{s.name}</span>
                              <Badge
                                variant={
                                  s.status === "connected"
                                    ? "default"
                                    : s.status === "disabled"
                                    ? "secondary"
                                    : "destructive"
                                }
                                className="text-[10px] px-1.5 py-0"
                              >
                                {s.status === "connected"
                                  ? `${s.tools.length} tools active`
                                  : s.status}
                              </Badge>
                            </div>

                            <div className="flex items-center gap-1">
                              <McpTrustSelect server={s.name} value={s.trust} />
                              {s.tools.length > 0 ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setExpandedServer(isExpanded ? null : s.name)
                                  }
                                  className="h-7 px-2 text-xs gap-1"
                                >
                                  Tools
                                  {isExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                disabled={deletingMcp === s.name}
                                onClick={() => void handleDeleteMcpServer(s.name)}
                              >
                                {deletingMcp === s.name ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </div>

                          <div className="text-xs text-muted-foreground font-mono bg-muted/40 p-2 rounded space-y-1">
                            <p>
                              <span className="font-sans">{remoteLabel(s.config)}</span>
                              {s.config.command ? (
                                <span>
                                  {s.config.command} {(s.config.args ?? []).join(" ")}
                                </span>
                              ) : (
                                <span>{s.config.url}</span>
                              )}
                            </p>
                            {headerNameList(s.config).length > 0 ? (
                              <p className="font-sans">
                                Headers:{" "}
                                {headerNameList(s.config)
                                  .map((h) => {
                                    const hint = secretHint(s.name, h, s.secretStatuses)
                                    return hint ? `${h} (${hint})` : h
                                  })
                                  .join(", ")}
                              </p>
                            ) : null}
                          </div>

                          {s.error ? (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                              {s.error}
                            </p>
                          ) : null}

                          {isExpanded && s.tools.length > 0 ? (
                            <div className="pt-2 border-t space-y-1.5">
                              <p className="text-xs font-medium text-muted-foreground">Provided Tools:</p>
                              <div className="grid grid-cols-1 gap-1">
                                {s.tools.map((t) => (
                                  <div
                                    key={t.name}
                                    className="text-xs font-mono bg-background p-1.5 rounded border flex flex-col gap-0.5"
                                  >
                                    <span className="font-semibold text-primary">{t.name}</span>
                                    {t.description ? (
                                      <span className="text-[11px] text-muted-foreground font-sans">
                                        {t.description}
                                      </span>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </CardContent>
              </Card>

              {/* Add MCP Server Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Add an MCP Server</CardTitle>
                  <CardDescription>
                    Add a local command, an HTTP server (POST), or an old SSE server.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="mcp-name">Server Name</Label>
                      <Input
                        id="mcp-name"
                        placeholder="e.g. crypto-tools, fetch, github"
                        value={mcpName}
                        onChange={(e) => setMcpName(e.target.value)}
                        spellCheck={false}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Transport Type</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={mcpType === "stdio" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setMcpType("stdio")}
                          aria-pressed={mcpType === "stdio"}
                          className="flex-1"
                        >
                          Command
                        </Button>
                        <Button
                          type="button"
                          variant={mcpType === "http" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setMcpType("http")}
                          aria-pressed={mcpType === "http"}
                          className="flex-1"
                        >
                          HTTP
                        </Button>
                        <Button
                          type="button"
                          variant={mcpType === "sse" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setMcpType("sse")}
                          aria-pressed={mcpType === "sse"}
                          className="flex-1"
                        >
                          SSE
                        </Button>
                      </div>
                    </div>
                  </div>

                  {mcpType === "stdio" ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="mcp-command">Command</Label>
                        <Input
                          id="mcp-command"
                          placeholder="e.g. npx, node, python3"
                          value={mcpCommand}
                          onChange={(e) => setMcpCommand(e.target.value)}
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="mcp-args">Arguments (space-separated)</Label>
                        <Input
                          id="mcp-args"
                          placeholder="e.g. -y crypto-mcp-server --port 8080"
                          value={mcpArgs}
                          onChange={(e) => setMcpArgs(e.target.value)}
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="mcp-url">
                          {mcpType === "http" ? "Server URL" : "Server URL (SSE)"}
                        </Label>
                        <Input
                          id="mcp-url"
                          placeholder={
                            mcpType === "http"
                              ? "https://your-app/api/mcp"
                              : "https://mcp.example.com/sse"
                          }
                          value={mcpUrl}
                          onChange={(e) => setMcpUrl(e.target.value)}
                          spellCheck={false}
                        />
                        {mcpType === "http" ? (
                          <p className="text-xs text-muted-foreground">
                            Uses HTTP POST. The address should end with the MCP path, like /api/mcp.
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Old SSE connection. It opens the URL with GET.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Headers</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setMcpHeaders((rows) => [...rows, { name: "", value: "" }])
                            }
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add header
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          For GitHub MCP, use Authorization and{" "}
                          <span className="font-mono">Bearer ghp_…</span> (or a fine-grained PAT).
                          Values are saved as secrets; only a{" "}
                          <code className="rounded bg-muted px-1">{`\${secret:…}`}</code> placeholder
                          is written to{" "}
                          <code className="rounded bg-muted px-1">.black-agents/mcp.json</code>.
                        </p>
                        {mcpHeaders.map((row, index) => (
                          <div key={index} className="flex gap-2">
                            <Input
                              className="min-w-0 flex-1"
                              aria-label={`Header ${index + 1} name`}
                              placeholder="Authorization"
                              value={row.name}
                              onChange={(e) =>
                                setMcpHeaders((rows) =>
                                  rows.map((item, i) =>
                                    i === index ? { ...item, name: e.target.value } : item
                                  )
                                )
                              }
                              spellCheck={false}
                              autoComplete="off"
                            />
                            <Input
                              className="min-w-0 flex-1"
                              type="password"
                              aria-label={`Header ${index + 1} value`}
                              placeholder="Bearer ghp_… or other token"
                              value={row.value}
                              onChange={(e) =>
                                setMcpHeaders((rows) =>
                                  rows.map((item, i) =>
                                    i === index ? { ...item, value: e.target.value } : item
                                  )
                                )
                              }
                              spellCheck={false}
                              autoComplete="new-password"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              aria-label={`Remove header ${index + 1}`}
                              onClick={() =>
                                setMcpHeaders((rows) =>
                                  rows.length === 1
                                    ? [{ name: "", value: "" }]
                                    : rows.filter((_, i) => i !== index)
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    disabled={savingMcp || !mcpName.trim()}
                    onClick={() => void handleSaveMcpServer()}
                    className="gap-1.5"
                  >
                    {savingMcp ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plug className="h-4 w-4" />
                    )}
                    Test & Save Server
                  </Button>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Your saved workspaces card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved workspaces</CardTitle>
          <CardDescription>
            Switch between workspaces. The active one is read, written, and visualized in BlackAgents.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {workspaces.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No workspaces yet. Create or open one above to get started.
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
                      onClick={() => void activate(ws.path)}
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
                    onClick={() => void remove(ws.path)}
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
