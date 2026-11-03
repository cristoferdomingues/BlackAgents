"use client"

import * as React from "react"
import { Loader2, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

interface TrustSnapshot {
  shellCommands: string[]
}

/**
 * Programs the user chose to run without a card ("Always allow npm").
 * Trust is user-level and workspace-scoped, so it never travels with a repo.
 */
export function TrustedCommandsCard(): React.ReactElement {
  const { workspace } = useWorkspace()
  const [programs, setPrograms] = React.useState<string[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    apiFetch<TrustSnapshot>("/api/trust")
      .then((data) => {
        if (cancelled) return
        setPrograms(data.shellCommands)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Could not load trusted commands")
      })
    return () => {
      cancelled = true
    }
  }, [workspace?.path, reloadKey])

  async function revoke(program: string): Promise<void> {
    setBusy(program)
    try {
      const data = await apiFetch<TrustSnapshot>("/api/trust", {
        method: "PUT",
        body: JSON.stringify({ shellCommands: [program], trusted: false }),
      })
      setPrograms(data.shellCommands)
      toast.success(`${program} will ask again`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke the trust")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Trusted commands
        </CardTitle>
        <CardDescription>
          Shell programs that run without an approval card in this workspace. Trust is stored on
          this machine, not in the project, so a cloned repository cannot bring its own grants.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-destructive">{error}</span>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        ) : programs === null ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-8 w-32" />
          </div>
        ) : programs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No trusted commands yet. Use “Always allow” on an approval card to remember a program.
          </p>
        ) : (
          <ul className="space-y-2">
            {programs.map((program) => (
              <li
                key={program}
                className="flex items-center justify-between gap-3 rounded-md border p-2"
              >
                <code className="font-mono text-sm">{program}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Revoke trust for ${program}`}
                  disabled={busy !== null}
                  onClick={() => void revoke(program)}
                >
                  {busy === program ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
