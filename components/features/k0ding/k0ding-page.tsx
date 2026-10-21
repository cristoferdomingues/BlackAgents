"use client"

import * as React from "react"
import { Eye, EyeOff, FolderOpen, HelpCircle, Pin, Search, SquareCode } from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import {
  K0DING_INTRO,
  K0DING_STEPS,
  K0DING_TITLE,
  OPEN_EFFECT,
  SECRET_NOTE,
} from "@/lib/k0ding/explain"
import type { CodeRoot, CodingSessionView, FileView } from "@/lib/k0ding/schema"
import { streamPost, type SseEvent } from "@/lib/sse-client"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { useAssistantProvider } from "@/components/features/editor/use-assistant-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { CodeView } from "@/components/features/k0ding/code-view"
import { FileTree } from "@/components/features/k0ding/file-tree"
import { PromptPanel } from "@/components/features/k0ding/prompt-panel"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

const INTRO_KEY = "blackagents.k0ding.intro"

function subscribeNoop(): () => void {
  return () => undefined
}

type DesktopBridge = { pickDirectory?: () => Promise<string | null> }

function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === "undefined") return undefined
  return (window as Window & { blackAgentsDesktop?: DesktopBridge }).blackAgentsDesktop
}

interface OpenFile {
  path: string
  view: FileView | null
  error: string | null
}

export function K0dingPage(): React.ReactElement {
  const { workspace, loading: workspaceLoading, project } = useWorkspace()
  const assistant = useAssistantProvider()
  const [roots, setRoots] = React.useState<CodeRoot[] | null>(null)
  const [rootsError, setRootsError] = React.useState<string | null>(null)
  const [rootId, setRootId] = React.useState<string | null>(null)
  const [folderPath, setFolderPath] = React.useState("")
  const [opening, setOpening] = React.useState(false)
  const [showHidden, setShowHidden] = React.useState(false)
  const [files, setFiles] = React.useState<OpenFile[]>([])
  const [activePath, setActivePath] = React.useState<string | null>(null)
  const [pinned, setPinned] = React.useState<string[]>([])
  const [query, setQuery] = React.useState("")
  const [matches, setMatches] = React.useState<Array<{ path: string; line: number; text: string }>>([])
  const [quickOpen, setQuickOpen] = React.useState(false)
  const [quickQuery, setQuickQuery] = React.useState("")
  const [quickPaths, setQuickPaths] = React.useState<string[]>([])
  const [session, setSession] = React.useState<CodingSessionView | null>(null)
  const [activity, setActivity] = React.useState<string[]>([])
  const [live, setLive] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const introDismissed = React.useSyncExternalStore(subscribeNoop, () => window.localStorage.getItem(INTRO_KEY) === "1", () => true)
  const [introOverride, setIntroOverride] = React.useState<boolean | null>(null)
  const introOpen = introOverride ?? !introDismissed
  const canBrowse = React.useSyncExternalStore(subscribeNoop, () => typeof desktopBridge()?.pickDirectory === "function", () => false)

  const loadRoots = React.useCallback((): void => {
    apiFetch<{ roots: CodeRoot[] }>("/api/k0ding/roots")
      .then((data) => {
        setRoots(data.roots)
        setRootsError(null)
        setRootId((current) => (current && data.roots.some((root) => root.id === current) ? current : data.roots[0]?.id ?? null))
      })
      .catch((err: unknown) => setRootsError(err instanceof ApiError ? err.message : "Could not load code folders"))
  }, [])

  React.useEffect(() => {
    if (!workspace) return
    loadRoots()
  }, [workspace, project?.id, loadRoots])

  React.useEffect(() => {
    if (!rootId) return
    apiFetch<{ session: CodingSessionView | null }>(`/api/k0ding/sessions?rootId=${rootId}`)
      .then((data) => setSession(data.session))
      .catch(() => setSession(null))
  }, [rootId])

  React.useEffect(() => {
    if (!rootId || query.trim().length < 2) return
    const handle = window.setTimeout(() => {
      apiFetch<{ matches: Array<{ path: string; line: number; text: string }> }>(
        `/api/k0ding/roots/${rootId}/search?q=${encodeURIComponent(query.trim())}`
      )
        .then((data) => setMatches(data.matches))
        .catch(() => setMatches([]))
    }, 250)
    return () => window.clearTimeout(handle)
  }, [query, rootId])

  React.useEffect(() => {
    if (!quickOpen || !rootId || quickQuery.trim().length < 1) return
    const handle = window.setTimeout(() => {
      apiFetch<{ paths: string[] }>(`/api/k0ding/roots/${rootId}/find?q=${encodeURIComponent(quickQuery.trim())}`)
        .then((data) => setQuickPaths(data.paths))
        .catch(() => setQuickPaths([]))
    }, 200)
    return () => window.clearTimeout(handle)
  }, [quickOpen, quickQuery, rootId])

  const pending = (session?.changes ?? []).some((change) => change.state === "pending")
  React.useEffect(() => {
    if (!pending) return
    const onLeave = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", onLeave)
    return () => window.removeEventListener("beforeunload", onLeave)
  }, [pending])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault()
        setQuickOpen(true)
      }
      if (event.key === "Escape" && running) abortRef.current?.abort()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [running])

  function toggleIntro(): void {
    const next = !introOpen
    setIntroOverride(next)
    if (!next) window.localStorage.setItem(INTRO_KEY, "1")
  }

  async function openFolder(folder: string): Promise<void> {
    const trimmed = folder.trim()
    if (!trimmed) return
    setOpening(true)
    try {
      const root = await apiFetch<CodeRoot>("/api/k0ding/roots", {
        method: "POST",
        body: JSON.stringify({ path: trimmed }),
      })
      setRoots((current) => [...(current ?? []).filter((item) => item.id !== root.id), root])
      setRootId(root.id)
      setFolderPath("")
      toast.success("Folder opened")
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open that folder")
    } finally {
      setOpening(false)
    }
  }

  async function browse(): Promise<void> {
    const picked = await desktopBridge()?.pickDirectory?.()
    if (picked) {
      setFolderPath(picked)
      await openFolder(picked)
    }
  }

  function openFile(path: string): void {
    setActivePath(path)
    setFiles((current) => (current.some((file) => file.path === path) ? current : [...current, { path, view: null, error: null }]))
    if (!rootId) return
    apiFetch<FileView>(`/api/k0ding/roots/${rootId}/file?path=${encodeURIComponent(path)}`)
      .then((view) => {
        setFiles((current) => current.map((file) => (file.path === path ? { path, view, error: null } : file)))
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Could not open that file"
        setFiles((current) => current.map((file) => (file.path === path ? { path, view: null, error: message } : file)))
      })
  }

  function pinActive(): void {
    const file = files.find((item) => item.path === activePath)
    if (!file?.view || file.view.secret || !activePath) {
      if (file?.view?.secret) toast.error(SECRET_NOTE)
      return
    }
    setPinned((current) => (current.includes(activePath) ? current : [...current, activePath]))
  }

  async function send(prompt: string): Promise<void> {
    if (!rootId) return
    const resolved = assistant.resolve()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setActivity([])
    setLive("")
    const url = session ? `/api/k0ding/sessions/${session.id}/messages` : "/api/k0ding/sessions"
    const body = session
      ? { prompt }
      : {
          rootId,
          prompt,
          context: pinned,
          ...(resolved ? { provider: resolved.provider, model: resolved.model } : {}),
        }
    try {
      await streamPost(url, body, (event) => onStream(event), controller.signal)
    } catch (err) {
      if (!controller.signal.aborted) toast.error(err instanceof ApiError ? err.message : "The model could not run")
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function onStream(event: SseEvent): void {
    if (event.event === "tool" && event.data && typeof event.data === "object" && "summary" in event.data) {
      const summary = String((event.data as { summary?: unknown }).summary ?? "")
      if (summary) setActivity((current) => [...current, summary])
    }
    if (event.event === "token" && event.data && typeof event.data === "object" && "content" in event.data) {
      const content = String((event.data as { content?: unknown }).content ?? "")
      if (content) setLive((text) => text + content)
    }
    if (event.event === "error" && event.data && typeof event.data === "object" && "message" in event.data) {
      toast.error(String((event.data as { message?: unknown }).message ?? "The model could not run"))
    }
    if (event.event === "done" && event.data && typeof event.data === "object" && "session" in event.data) {
      const next = (event.data as { session: CodingSessionView }).session
      setSession(next)
      setActivity([])
      setLive("")
    }
  }

  const active = files.find((file) => file.path === activePath) ?? null

  if (!workspace && !workspaceLoading) {
    return <NoWorkspace message="Select a workspace to save your code folders." />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <SquareCode className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{K0DING_TITLE}</h1>
            <p className="text-sm text-muted-foreground">{K0DING_INTRO}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={toggleIntro} aria-expanded={introOpen}>
          <HelpCircle className="h-4 w-4" />
          How it works
        </Button>
      </div>

      {introOpen ? (
        <section aria-labelledby="k0ding-how" className="mx-4 mb-3 space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="k0ding-how" className="text-sm font-semibold">How K0ding works</h2>
            <Button variant="ghost" size="sm" onClick={toggleIntro}>Got it</Button>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {K0DING_STEPS.map((step) => (
              <li key={step.title} className="space-y-1 rounded-md bg-muted/40 p-3">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {rootsError ? (
        <div className="mx-4 rounded-lg border border-destructive/40 p-4">
          <p className="text-sm">{rootsError}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={loadRoots}>Try again</Button>
        </div>
      ) : roots === null ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 border-t">
          <aside className="flex w-72 shrink-0 flex-col border-r">
            <div className="space-y-2 border-b p-3">
              {roots.length > 0 ? (
                <Select value={rootId ?? undefined} onValueChange={setRootId}>
                  <SelectTrigger aria-label="Code folder">
                    <SelectValue placeholder="Choose a folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {roots.map((root) => (
                      <SelectItem key={root.id} value={root.id}>{root.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">Open a folder to start. You will see its files here.</p>
              )}
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void openFolder(folderPath)
                }}
              >
                <Input
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                  placeholder="Path to a code folder"
                  aria-label="Path to a code folder"
                />
                <Button type="submit" size="sm" disabled={opening || !folderPath.trim()}>Open</Button>
              </form>
              {canBrowse ? (
                <Button type="button" size="sm" variant="outline" disabled={opening} onClick={() => void browse()}>
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </Button>
              ) : null}
              <p className="text-[11px] text-muted-foreground">{OPEN_EFFECT}</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search text"
                    aria-label="Search in files"
                    className="h-8 pl-7"
                    disabled={!rootId}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  aria-pressed={showHidden}
                  aria-label={showHidden ? "Hide ignored files" : "Show ignored files"}
                  onClick={() => setShowHidden((current) => !current)}
                >
                  {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {query.trim().length >= 2 ? (
                <ul className="space-y-1 p-2">
                  {matches.length === 0 ? <li className="px-2 text-xs text-muted-foreground">No matches</li> : null}
                  {matches.map((match) => (
                    <li key={`${match.path}:${match.line}`}>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1 text-left hover:bg-accent"
                        onClick={() => openFile(match.path)}
                      >
                        <span className="block truncate text-xs font-medium">{match.path}:{match.line}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{match.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : rootId ? (
                <FileTree key={`${rootId}:${showHidden ? "all" : "clean"}`} rootId={rootId} showHidden={showHidden} activePath={activePath} onOpen={openFile} />
              ) : null}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1 overflow-x-auto border-b px-2">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`shrink-0 border-b-2 px-2 py-2 text-xs ${activePath === file.path ? "border-primary" : "border-transparent text-muted-foreground"}`}
                  onClick={() => setActivePath(file.path)}
                >
                  {file.path.slice(file.path.lastIndexOf("/") + 1)}
                </button>
              ))}
              {active?.view && !active.view.secret ? (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={pinActive}>
                  <Pin className="h-3.5 w-3.5" />
                  Pin
                </Button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {!active ? (
                <p className="p-6 text-sm text-muted-foreground">Open a file from the tree. Press Cmd or Ctrl + P to find one by name.</p>
              ) : active.error ? (
                <p className="p-6 text-sm text-destructive">{active.error}</p>
              ) : !active.view ? (
                <Skeleton className="m-4 h-64" />
              ) : active.view.message && active.view.content === null ? (
                <p className="p-6 text-sm text-muted-foreground">{active.view.message}</p>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  {active.view.secret ? <p className="border-b px-3 py-2 text-xs text-muted-foreground">{SECRET_NOTE}</p> : null}
                  <div className="min-h-0 flex-1">
                    <CodeView path={active.path} content={active.view.content ?? ""} />
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="w-96 shrink-0 border-l">
            {rootId ? (
              <PromptPanel
                rootId={rootId}
                pinned={pinned}
                onUnpin={(path) => setPinned((current) => current.filter((item) => item !== path))}
                session={session}
                activity={activity}
                live={live}
                running={running}
                onSend={(prompt) => void send(prompt)}
                onStop={() => abortRef.current?.abort()}
                onSession={setSession}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Open a folder before you ask the model to change code.</p>
            )}
          </aside>
        </div>
      )}

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open a file</DialogTitle>
            <DialogDescription>Type part of a file name.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={quickQuery}
            onChange={(event) => setQuickQuery(event.target.value)}
            placeholder="server.ts"
            aria-label="File name"
          />
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {(quickOpen && quickQuery.trim() ? quickPaths : []).map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    openFile(path)
                    setQuickOpen(false)
                  }}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}
