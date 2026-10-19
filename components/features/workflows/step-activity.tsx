"use client"

import { AlertTriangle, Loader2 } from "lucide-react"

import {
  formatElapsed,
  isStale,
  STALE_ACTIVITY_MS,
} from "@/lib/workflows/live"
import type { StepRun } from "@/lib/workflows/schema"
import { Badge } from "@/components/ui/badge"

import { useNow } from "./use-now"

function activityAgeMs(activitySince: string | undefined, now: number): number {
  if (!activitySince) return 0
  const at = Date.parse(activitySince)
  return Number.isNaN(at) ? 0 : Math.max(0, now - at)
}

/** Live turn counter, current action, recent feed, and stuck warning. */
export function StepActivityPanel({
  step,
  stepTimeoutMinutes,
}: {
  step: StepRun
  stepTimeoutMinutes?: number
}) {
  const live = step.status === "running" || step.status === "waiting_approval" || step.status === "waiting_login"
  const now = useNow(1_000, live)
  if (!live && !step.recent?.length) return null

  const startedMs = step.startedAt ? Date.parse(step.startedAt) : Number.NaN
  const elapsedMs = Number.isNaN(startedMs) ? 0 : Math.max(0, now - startedMs)
  const stale = live && isStale(step.lastActivityAt, now, STALE_ACTIVITY_MS)
  const staleFor = step.lastActivityAt
    ? formatElapsed(Math.max(0, now - Date.parse(step.lastActivityAt)))
    : ""
  const actionAge = formatElapsed(activityAgeMs(step.activity?.since, now))
  const timeoutLeft =
    stepTimeoutMinutes && !Number.isNaN(startedMs)
      ? Math.max(0, stepTimeoutMinutes * 60_000 - elapsedMs)
      : undefined

  return (
    <div className="space-y-2 border-t pt-3" data-testid="step-activity">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {!Number.isNaN(startedMs) ? <span>Elapsed {formatElapsed(elapsedMs)}</span> : null}
        {step.turn != null && step.maxTurns != null ? (
          <Badge variant="outline" data-testid="step-turn">
            Turn {step.turn} / {step.maxTurns}
          </Badge>
        ) : null}
        {timeoutLeft != null ? <span>Times out in {formatElapsed(timeoutLeft)}</span> : null}
      </div>

      {step.activity && live ? (
        <p className="flex items-center gap-2 text-sm" aria-live="polite" data-testid="step-action">
          {step.activity.kind === "waiting_model" || step.activity.kind === "running_tool" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          ) : null}
          <span>
            {step.activity.label}
            {step.activity.kind !== "idle" ? ` (${actionAge})` : null}
          </span>
        </p>
      ) : null}

      {stale ? (
        <div
          role="alert"
          data-testid="step-stale"
          className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            No activity for {staleFor}. The model may be slow or stuck.
            {timeoutLeft != null ? ` Step times out in ${formatElapsed(timeoutLeft)}.` : null} You can cancel the
            run.
          </p>
        </div>
      ) : null}

      {step.recent && step.recent.length > 0 ? (
        <ul className="max-h-32 space-y-1 overflow-auto text-xs text-muted-foreground" aria-label="Recent activity">
          {[...step.recent].reverse().map((entry, i) => (
            <li key={`${entry.at}-${i}`} className="font-mono">
              {entry.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
