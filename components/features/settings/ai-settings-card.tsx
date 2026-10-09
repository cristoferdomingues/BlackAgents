"use client"

import * as React from "react"
import { Brain, CheckCircle2, Loader2, Plug, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { AiSettings, JevOpenRouterKeySource, JevProviderPreference } from "@/lib/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

interface AiSettingsSnapshot {
  settings: AiSettings
  jevKey: { configured: boolean; last4?: string }
  jevOpenRouterKey: { configured: boolean; last4?: string }
  aiOpenRouter: { available: true; last4: string } | { available: false }
  openRouterAvailable: boolean
  activeProvider: "direct" | "openrouter" | null
}

const PROVIDER_LABELS: Record<JevProviderPreference, string> = {
  auto: "Auto (TypeSafe key first, then OpenRouter)",
  direct: "TypeSafe key only",
  openrouter: "OpenRouter only",
}

const OPENROUTER_SOURCE_LABELS: Record<JevOpenRouterKeySource, string> = {
  reuse: "Reuse AI Providers → Custom (OpenRouter)",
  dedicated: "Dedicated OpenRouter API key for Jev",
}

/** Assistant limits and the optional Jev decision engine. */
export function AiSettingsCard() {
  const [data, setData] = React.useState<AiSettingsSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [keyInput, setKeyInput] = React.useState("")
  const [openRouterKeyInput, setOpenRouterKeyInput] = React.useState("")
  const [turns, setTurns] = React.useState("")
  const [busy, setBusy] = React.useState<"save" | "test" | "key" | "or-key" | null>(null)
  const [writeWarningOpen, setWriteWarningOpen] = React.useState(false)

  const load = React.useCallback((): void => {
    apiFetch<AiSettingsSnapshot>("/api/settings/ai")
      .then((next) => {
        setData(next)
        setTurns(String(next.settings.assistant.maxToolTurns))
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load AI settings"))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function save(body: Record<string, unknown>, kind: "save" | "key" | "or-key" = "save") {
    setBusy(kind)
    try {
      const next = await apiFetch<AiSettingsSnapshot>("/api/settings/ai", {
        method: "PUT",
        body: JSON.stringify(body),
      })
      setData(next)
      setTurns(String(next.settings.assistant.maxToolTurns))
      toast.success("AI settings saved")
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
      return false
    } finally {
      setBusy(null)
    }
  }

  async function testJev() {
    setBusy("test")
    try {
      const res = await apiFetch<{ provider: string; model: string }>("/api/settings/ai/jev-test", {
        method: "POST",
      })
      toast.success(`Jev works (${res.provider}, ${res.model})`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Jev test failed")
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-6 text-sm">
          <span className="text-destructive">{error}</span>
          <Button size="sm" variant="outline" onClick={() => load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-9 w-full animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  const jev = data.settings.jev
  const turnsValue = Number(turns)
  const turnsValid = Number.isInteger(turnsValue) && turnsValue >= 1 && turnsValue <= 20
  const showTypeSafeKey = jev.provider === "auto" || jev.provider === "direct"
  const showOpenRouterKey = jev.provider === "auto" || jev.provider === "openrouter"

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assistant</CardTitle>
          <CardDescription>
            How many tool rounds one reply may use, and whether file writes ask you first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="max-tool-turns">Tool-call limit per reply (1–20)</Label>
              <Input
                id="max-tool-turns"
                type="number"
                min={1}
                max={20}
                value={turns}
                onChange={(e) => setTurns(e.target.value)}
                className="w-32"
              />
            </div>
            <Button
              size="sm"
              disabled={!turnsValid || busy !== null || turnsValue === data.settings.assistant.maxToolTurns}
              onClick={() => void save({ assistant: { maxToolTurns: turnsValue } })}
            >
              Save
            </Button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Switch
                id="assistant-auto-file-writes"
                checked={data.settings.assistant.autoApproveFileWrites}
                disabled={busy !== null}
                onCheckedChange={(enabled) => {
                  if (enabled) setWriteWarningOpen(true)
                  else void save({ assistant: { autoApproveFileWrites: false } })
                }}
              />
              <Label htmlFor="assistant-auto-file-writes">Allow file writes without asking</Label>
            </div>
            {data.settings.assistant.autoApproveFileWrites ? (
              <div
                role="alert"
                className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p>
                  File writes run with no approval. The assistant can create and overwrite files in
                  your workspace, including files you did not mean to change. Check the files after
                  a chat. Writes into config folders still ask.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Off: each file write asks you to deny it, allow it for that message, or allow it for
                the chat.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={writeWarningOpen} onOpenChange={setWriteWarningOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allow file writes without asking?</DialogTitle>
            <DialogDescription>
              The assistant can create and change files in your workspace without asking you. It can
              overwrite a file you did not want to change. Check the files after each chat. Writes
              into config folders still ask.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWriteWarningOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => {
                void save({ assistant: { autoApproveFileWrites: true } }).then((saved) => {
                  if (saved) setWriteWarningOpen(false)
                })
              }}
            >
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Allow writes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-primary" />
            Jev decision engine
            {data.activeProvider ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> {data.activeProvider}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Optional. Jev is a fast classifier from TypeSafe. It picks which artifacts go into a chat,
            gates workflow steps, and decides what the Second Brain should learn. When it is off or
            fails, everything works as before.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="jev-enabled"
              checked={jev.enabled}
              disabled={busy !== null}
              onCheckedChange={(enabled) => void save({ jev: { enabled } })}
            />
            <Label htmlFor="jev-enabled">Use Jev</Label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="jev-provider">Provider</Label>
            <Select
              value={jev.provider}
              onValueChange={(value) => {
                const provider = value as JevProviderPreference
                const next: {
                  provider: JevProviderPreference
                  openRouterKeySource?: JevOpenRouterKeySource
                } = { provider }
                // Custom keys are not OpenRouter by default — don't leave "reuse" selected
                // when OpenRouter-only is chosen without an AI OpenRouter provider.
                if (
                  (provider === "openrouter" || provider === "auto") &&
                  !data.aiOpenRouter.available &&
                  jev.openRouterKeySource === "reuse"
                ) {
                  next.openRouterKeySource = "dedicated"
                }
                void save({ jev: next })
              }}
              disabled={busy !== null}
            >
              <SelectTrigger id="jev-provider" className="w-full sm:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_LABELS) as JevProviderPreference[]).map((id) => (
                  <SelectItem key={id} value={id}>
                    {PROVIDER_LABELS[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showTypeSafeKey ? (
            <div className="space-y-1">
              <Label htmlFor="jev-key">TypeSafe API key</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="jev-key"
                  type="password"
                  autoComplete="off"
                  placeholder={data.jevKey.configured ? `Saved (…${data.jevKey.last4})` : "ts-…"}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="w-full sm:w-72"
                />
                <Button
                  size="sm"
                  disabled={!keyInput.trim() || busy !== null}
                  onClick={async () => {
                    if (await save({ jevApiKey: keyInput.trim() }, "key")) setKeyInput("")
                  }}
                >
                  {busy === "key" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save key
                </Button>
                {data.jevKey.configured ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove TypeSafe key"
                    disabled={busy !== null}
                    onClick={() => void save({ jevApiKey: null }, "key")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showOpenRouterKey ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="space-y-1">
                <Label htmlFor="jev-or-source">OpenRouter key for Jev</Label>
                <Select
                  value={jev.openRouterKeySource}
                  onValueChange={(value) =>
                    void save({ jev: { openRouterKeySource: value as JevOpenRouterKeySource } })
                  }
                  disabled={busy !== null}
                >
                  <SelectTrigger id="jev-or-source" className="w-full sm:w-96">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(OPENROUTER_SOURCE_LABELS) as JevOpenRouterKeySource[]).map(
                      (id) => (
                        <SelectItem
                          key={id}
                          value={id}
                          disabled={id === "reuse" && !data.aiOpenRouter.available}
                        >
                          {OPENROUTER_SOURCE_LABELS[id]}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {data.aiOpenRouter.available
                    ? `AI Providers → Custom points at OpenRouter (…${data.aiOpenRouter.last4}). You can reuse that key or store a separate one for Jev only.`
                    : "AI Providers → Custom is not OpenRouter. A Custom key alone is not enough — either point Custom at https://openrouter.ai/api/v1 to reuse it, or save a dedicated OpenRouter key here."}
                </p>
              </div>

              {jev.openRouterKeySource === "reuse" ? (
                <p className="text-sm text-muted-foreground">
                  {data.aiOpenRouter.available
                    ? `Reusing AI Providers → Custom OpenRouter key (…${data.aiOpenRouter.last4}).`
                    : "Reuse is unavailable until Custom’s base URL is OpenRouter. Switch to a dedicated key, or update AI Providers."}
                </p>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="jev-or-key">OpenRouter API key</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="jev-or-key"
                      type="password"
                      autoComplete="off"
                      placeholder={
                        data.jevOpenRouterKey.configured
                          ? `Saved (…${data.jevOpenRouterKey.last4})`
                          : "sk-or-…"
                      }
                      value={openRouterKeyInput}
                      onChange={(e) => setOpenRouterKeyInput(e.target.value)}
                      className="w-full sm:w-72"
                    />
                    <Button
                      size="sm"
                      disabled={!openRouterKeyInput.trim() || busy !== null}
                      onClick={async () => {
                        if (
                          await save(
                            { jevOpenRouterApiKey: openRouterKeyInput.trim() },
                            "or-key"
                          )
                        ) {
                          setOpenRouterKeyInput("")
                        }
                      }}
                    >
                      {busy === "or-key" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Save key
                    </Button>
                    {data.jevOpenRouterKey.configured ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remove OpenRouter key"
                        disabled={busy !== null}
                        onClick={() => void save({ jevOpenRouterApiKey: null }, "or-key")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <Button size="sm" variant="outline" onClick={() => void testJev()} disabled={busy !== null}>
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Test connection
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
