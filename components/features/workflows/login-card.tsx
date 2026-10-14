"use client"

import * as React from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { PendingLogin } from "@/lib/workflows/schema"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Asks for a username and password, then resumes the same workflow step. */
export function LoginCard({ runId, login }: { runId: string; login: PendingLogin }) {
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  async function submit(alreadyLoggedIn: boolean): Promise<void> {
    setBusy(true)
    try {
      await apiFetch(`/api/runs/${encodeURIComponent(runId)}/login`, {
        method: "POST",
        body: JSON.stringify(
          alreadyLoggedIn
            ? { alreadyLoggedIn: true }
            : { username: username.trim(), password }
        ),
      })
      setPassword("")
      toast.success(alreadyLoggedIn ? "Continuing this step" : "Login saved. Continuing this step.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not continue the step")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="login-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Sign in to continue
        </CardTitle>
        <CardDescription>{login.reason}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="run-login-username">Username</Label>
            <Input
              id="run-login-username"
              autoComplete="username"
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="run-login-password">Password</Label>
            <Input
              id="run-login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !username.trim() || !password}
            onClick={() => void submit(false)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save and continue
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void submit(true)}>
            I already signed in
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
