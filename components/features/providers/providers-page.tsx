"use client"

import * as React from "react"
import {
  AlertCircle,
  CircleHelp,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
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
import {
  type ProviderDescriptor,
  type ProviderStatus,
  type ProvidersState,
} from "@/components/features/providers/provider-readiness"

type BusyAction = "save" | "verify" | "remove"

function checkedAtLabel(checkedAt?: string): string | null {
  if (!checkedAt) return null
  const date = new Date(checkedAt)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

export function ProvidersPage() {
  const [state, setState] = React.useState<ProvidersState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [keyDraft, setKeyDraft] = React.useState<Record<string, string>>({})
  const [urlDraft, setUrlDraft] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<{
    id: string
    action: BusyAction
  } | null>(null)

  const load = React.useCallback(async () => {
    await Promise.resolve()
    setLoading(true)
    setLoadError(null)
    try {
      const data = await apiFetch<ProvidersState>("/api/providers")
      setState(data)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load providers"
      )
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  function statusFor(id: string): ProviderStatus | undefined {
    return state?.status.find((s) => s.id === id)
  }

  async function saveKey(p: ProviderDescriptor) {
    const apiKey = (keyDraft[p.id] ?? "").trim()
    const baseUrl = (urlDraft[p.id] ?? statusFor(p.id)?.baseUrl ?? "").trim()
    if (p.requiresBaseUrl && !baseUrl) {
      toast.error("A base URL is required for this provider")
      return
    }
    if (!p.requiresBaseUrl && !apiKey) {
      toast.error("Enter an API key")
      return
    }
    setBusy({ id: p.id, action: "save" })
    try {
      const data = await apiFetch<ProvidersState>("/api/providers", {
        method: "POST",
        body: JSON.stringify({ id: p.id, apiKey, baseUrl }),
      })
      setState(data)
      setKeyDraft((d) => ({ ...d, [p.id]: "" }))
      toast.success(`${p.label} verified and saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save key")
    } finally {
      setBusy(null)
    }
  }

  async function reverify(p: ProviderDescriptor) {
    setBusy({ id: p.id, action: "verify" })
    try {
      const status = await apiFetch<ProviderStatus>("/api/providers/reverify", {
        method: "POST",
        body: JSON.stringify({ id: p.id }),
      })
      setState((current) =>
        current
          ? {
              ...current,
              status: current.status.map((item) =>
                item.id === p.id ? status : item
              ),
            }
          : current
      )
      toast.success(`${p.label} verified`)
    } catch (err) {
      await load()
      toast.error(
        err instanceof Error ? err.message : `Could not verify ${p.label}`
      )
    } finally {
      setBusy(null)
    }
  }

  async function removeKey(p: ProviderDescriptor) {
    setBusy({ id: p.id, action: "remove" })
    try {
      const data = await apiFetch<ProvidersState>(
        `/api/providers?id=${p.id}`,
        { method: "DELETE" }
      )
      setState(data)
      setUrlDraft((d) => ({ ...d, [p.id]: "" }))
      toast.success(`${p.label} removed`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove key")
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading…
      </div>
    )
  }

  if (loadError || !state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <div>
          <p className="font-medium">Could not load providers</p>
          <p className="text-sm text-muted-foreground">
            {loadError ?? "The provider service returned no data."}
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Providers</h1>
        <p className="text-sm text-muted-foreground">
          Bring your own key. Keys are stored locally in{" "}
          <code className="rounded bg-muted px-1">~/.black-agents/secrets.json</code>{" "}
          and never leave this machine — the assistant calls the provider from
          the local server.
        </p>
      </div>

      {state.providers.map((p) => {
        const status = statusFor(p.id)
        const isBusy = busy?.id === p.id
        const isChecking =
          isBusy && (busy.action === "save" || busy.action === "verify")
        const checkedAt = checkedAtLabel(status?.checkedAt)
        return (
          <Card key={p.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  {p.label}
                  {isChecking ? (
                    <Badge
                      variant="outline"
                      aria-live="polite"
                    >
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Checking
                    </Badge>
                  ) : status?.verificationStatus === "valid" ? (
                    <Badge
                      variant="outline"
                      className="border-transparent bg-skill/15 text-skill"
                    >
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      Verified
                    </Badge>
                  ) : status?.verificationStatus === "invalid" ? (
                    <Badge variant="destructive">
                      <AlertCircle className="mr-1 h-3 w-3" />
                      Invalid
                    </Badge>
                  ) : status?.configured ? (
                    <Badge variant="secondary">
                      <CircleHelp className="mr-1 h-3 w-3" />
                      Unverified
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  {status?.configured && status.last4
                    ? `Key ending in …${status.last4}`
                    : p.requiresBaseUrl
                      ? "Any OpenAI-compatible endpoint (Ollama, LM Studio, a gateway)."
                      : "No key stored yet."}
                </CardDescription>
                {status?.configured ? (
                  <p className="text-xs text-muted-foreground">
                    {status.verificationStatus === "valid"
                      ? `Ready for chat${checkedAt ? ` · Checked ${checkedAt}` : ""}.`
                      : status.verificationStatus === "invalid"
                        ? `The provider rejected these credentials${checkedAt ? ` · Checked ${checkedAt}` : ""}. Update them or retry verification.`
                        : "Stored credentials must be verified before chat is available."}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {status?.configured ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void reverify(p)}
                    disabled={isBusy}
                  >
                    {busy?.id === p.id && busy.action === "verify" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {status.verificationStatus === "invalid"
                      ? "Retry"
                      : status.verificationStatus === "unverified"
                        ? "Verify"
                        : "Verify again"}
                  </Button>
                ) : null}
                {status?.configured ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void removeKey(p)}
                    disabled={isBusy}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {p.requiresBaseUrl ? (
                <div className="space-y-2">
                  <Label htmlFor={`url-${p.id}`}>Base URL</Label>
                  <Input
                    id={`url-${p.id}`}
                    placeholder="http://localhost:11434/v1"
                    value={urlDraft[p.id] ?? status?.baseUrl ?? ""}
                    onChange={(e) =>
                      setUrlDraft((d) => ({ ...d, [p.id]: e.target.value }))
                    }
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor={`key-${p.id}`}>
                  API key{" "}
                  {p.requiresBaseUrl ? (
                    <span className="font-normal text-muted-foreground">
                      (optional for local endpoints)
                    </span>
                  ) : null}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`key-${p.id}`}
                    type="password"
                    placeholder={
                      status?.configured ? "Enter a new key to replace" : "sk-…"
                    }
                    value={keyDraft[p.id] ?? ""}
                    onChange={(e) =>
                      setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))
                    }
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button onClick={() => void saveKey(p)} disabled={isBusy}>
                    {busy?.id === p.id && busy.action === "save" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Verify & save
                  </Button>
                </div>
              </div>

              {p.models.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Models: {p.models.join(", ")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
