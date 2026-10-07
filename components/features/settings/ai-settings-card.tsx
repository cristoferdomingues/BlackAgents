"use client"

import * as React from "react"
import { Brain, CheckCircle2, Loader2, Plug, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { AiSettings, JevProviderPreference } from "@/lib/settings"
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
  openRouterAvailable: boolean
  activeProvider: "direct" | "openrouter" | null
}

const PROVIDER_LABELS: Record<JevProviderPreference, string> = {
  auto: "Auto (TypeSafe key first, then OpenRouter)",
  direct: "TypeSafe key only",
  openrouter: "OpenRouter only",
}

/** Assistant limits and the optional Jev decision engine. */
export function AiSettingsCard() {
  const [data, setData] = React.useState<AiSettingsSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [keyInput, setKeyInput] = React.useState("")
  const [turns, setTurns] = React.useState("")
  const [busy, setBusy] = React.useState<"save" | "test" | "key" | null>(null)

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

  async function save(body: Record<string, unknown>, kind: "save" | "key" = "save") {
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assistant</CardTitle>
          <CardDescription>How many tool rounds one reply may use before it must answer.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
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
        </CardContent>
      </Card>

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
              onValueChange={(provider) => void save({ jev: { provider } })}
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
            <p className="text-xs text-muted-foreground">
              {data.openRouterAvailable
                ? "Your custom provider points to OpenRouter, so its key can also run Jev."
                : "To use OpenRouter, set the custom provider base URL to https://openrouter.ai/api/v1."}
            </p>
          </div>
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
          <Button size="sm" variant="outline" onClick={() => void testJev()} disabled={busy !== null}>
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Test connection
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
