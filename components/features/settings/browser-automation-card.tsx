"use client"

import * as React from "react"
import {
  CircleCheck,
  Loader2,
  Monitor,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Badge } from "@/components/ui/badge"
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

interface BrowserFlowSummary {
  name: string
  description: string
  stepCount: number
  profile: string
  startUrl?: string
  updatedAt: string
}

interface BrowserStatus {
  desktop: boolean
  configured: boolean
  disabled: boolean
  profileDir: string
  profileExists: boolean
  reason: string | null
  flows: BrowserFlowSummary[]
  recording: {
    startedAt: string
    stepCount: number
    steps: Array<{ id: string; tool: string; args: Record<string, unknown> }>
  } | null
}

export function BrowserAutomationCard() {
  const { workspace } = useWorkspace()
  const [status, setStatus] = React.useState<BrowserStatus | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [flowName, setFlowName] = React.useState("my-browser-flow")
  const [dailyAt, setDailyAt] = React.useState("09:05")

  const load = React.useCallback(async () => {
    if (!workspace) {
      setStatus(null)
      return
    }
    setLoading(true)
    try {
      const data = await apiFetch<BrowserStatus>("/api/browser")
      setStatus(data)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [workspace])

  React.useEffect(() => {
    void load()
  }, [load])

  async function setup() {
    setBusy(true)
    try {
      await apiFetch("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "setup" }),
      })
      toast.success("Playwright browser MCP configured (trust: risky)")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed")
    } finally {
      setBusy(false)
    }
  }

  async function startRecording() {
    setBusy(true)
    try {
      await apiFetch("/api/browser/record", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      })
      toast.success("Recording started — use Chat with browser tools to teach the flow")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start recording")
    } finally {
      setBusy(false)
    }
  }

  async function stopRecording(save: boolean) {
    setBusy(true)
    try {
      const res = await apiFetch<{
        flow?: { name: string }
        discarded?: boolean
      }>("/api/browser/record", {
        method: "POST",
        body: JSON.stringify(
          save
            ? {
                action: "stop",
                saveAs: flowName.trim(),
                description: `Recorded browser flow ${flowName.trim()}`,
                bind: true,
              }
            : { action: "stop" }
        ),
      })
      toast.success(
        save && res.flow
          ? `Saved flow "${res.flow.name}" and created skill/agent`
          : "Recording discarded"
      )
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not stop recording")
    } finally {
      setBusy(false)
    }
  }

  async function bindDaily(name: string) {
    setBusy(true)
    try {
      await apiFetch("/api/browser/bind", {
        method: "POST",
        body: JSON.stringify({
          flowName: name,
          agentName: `${name}-agent`,
          overwrite: true,
          daily: {
            workflowName: `${name}-daily`,
            at: dailyAt,
            task: `Run the browser flow ${name}`,
            description: `Daily run of ${name}`,
          },
        }),
      })
      toast.success(`Bound skill/agent and daily workflow at ${dailyAt}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bind failed")
    } finally {
      setBusy(false)
    }
  }

  async function removeFlow(name: string) {
    setBusy(true)
    try {
      await apiFetch(`/api/browser/flows/${encodeURIComponent(name)}`, {
        method: "DELETE",
      })
      toast.success(`Deleted flow "${name}"`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setBusy(false)
    }
  }

  if (!workspace) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Select an active workspace to configure browser automation.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            Browser automation
          </CardTitle>
          <CardDescription>
            Electron desktop only. Uses Playwright MCP with a persistent profile under{" "}
            <code className="rounded bg-muted px-1">~/.black-agents/browser-profiles/</code>.
            Run <code className="rounded bg-muted px-1">npm run desktop:install-browser</code> once
            to install Chromium.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && !status ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : null}

          {status ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.desktop ? "default" : "destructive"}>
                  {status.desktop ? "Desktop runtime" : "Not desktop"}
                </Badge>
                <Badge variant={status.configured ? "default" : "secondary"}>
                  {status.configured ? "MCP configured" : "MCP not set up"}
                </Badge>
                <Badge variant={status.profileExists ? "default" : "secondary"}>
                  {status.profileExists ? "Profile has data" : "Empty profile"}
                </Badge>
              </div>

              {status.reason ? (
                <p className="flex items-start gap-2 text-destructive">
                  <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  {status.reason}
                </p>
              ) : null}

              <p className="text-xs text-muted-foreground font-mono break-all">
                Profile: {status.profileDir}
              </p>

              <Button
                disabled={busy || !status.desktop}
                onClick={() => void setup()}
                className="gap-1.5"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
                Enable Playwright MCP
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record a flow</CardTitle>
          <CardDescription>
            Start recording, then teach in Assistant chat with the browser MCP tools. Successful
            browser calls are captured. Stop to save a flow under{" "}
            <code className="rounded bg-muted px-1">.black-agents/browser-flows/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="flow-name">Flow name (kebab-case)</Label>
            <Input
              id="flow-name"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              spellCheck={false}
            />
          </div>

          {status?.recording ? (
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <p className="text-sm font-medium">
                Recording… {status.recording.stepCount} step
                {status.recording.stepCount === 1 ? "" : "s"}
              </p>
              <ul className="text-xs font-mono space-y-1 max-h-40 overflow-auto">
                {status.recording.steps.map((s) => (
                  <li key={s.id}>
                    {s.tool} {JSON.stringify(s.args).slice(0, 120)}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void stopRecording(true)}
                  className="gap-1.5"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop & save
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void stopRecording(false)}
                >
                  Discard
                </Button>
              </div>
            </div>
          ) : (
            <Button
              disabled={busy || !status?.desktop}
              variant="outline"
              onClick={() => void startRecording()}
            >
              Start recording
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved flows</CardTitle>
          <CardDescription>
            Bind a daily workflow (runs while the desktop app is open). Default time:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2 max-w-xs">
            <div className="space-y-2 flex-1">
              <Label htmlFor="daily-at">Daily at (HH:MM)</Label>
              <Input
                id="daily-at"
                value={dailyAt}
                onChange={(e) => setDailyAt(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          {!status?.flows.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No flows yet. Record one or save traces from Chat.
            </p>
          ) : (
            <ul className="space-y-2">
              {status.flows.map((f) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{f.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.stepCount} steps
                      {f.startUrl ? ` · ${f.startUrl}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void bindDaily(f.name)}
                    >
                      Daily bind
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      aria-label={`Delete flow ${f.name}`}
                      onClick={() => void removeFlow(f.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
