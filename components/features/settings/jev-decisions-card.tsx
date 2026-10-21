"use client"

import * as React from "react"
import { History, Loader2, Lock, RefreshCw, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  JEV_CUTOFF_LEVELS,
  JEV_CUTOFF_VALUES,
  summarizeDecisions,
  TUNABLE_DECISIONS,
  type DecisionLogEntry,
  type DecisionOutcome,
  type DecisionSummary,
  type JevCutoffLevel,
  type JevCutoffLevels,
  type TunableDecision,
} from "@/lib/decision/cutoffs"
import {
  choiceLabel,
  CLEAR_DIALOG_TITLE,
  CLEAR_EFFECT,
  CUTOFFS_INTRO,
  CUTOFFS_TITLE,
  DECISION_HELP,
  DECISION_LABELS,
  DECISIONS_INTRO,
  DECISIONS_LOAD_ERROR,
  DECISIONS_TITLE,
  DECISIONS_WHERE,
  EAGER_WARNING,
  EMPTY_TITLE,
  emptyText,
  HIGH_STAKES,
  LEVEL_LABELS,
  LEVEL_RISK,
  LEVEL_SAVE_EFFECT,
  LEVEL_SUMMARIES,
  levelLabel,
  logLimitLine,
  OUTCOME_HELP,
  OUTCOME_LABELS,
  percent,
  PREFLIGHT_FIXED,
  RECENT_TITLE,
  scoreLine,
  summaryLine,
  wouldUseLine,
} from "@/lib/decision/explain"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface DecisionLogSnapshot {
  entries: DecisionLogEntry[]
  max: number
}

const OUTCOME_STYLES: Record<DecisionOutcome, string> = {
  acted: "border-transparent bg-skill/15 text-skill",
  below: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pass: "",
  error: "border-transparent bg-destructive/15 text-destructive",
}

const RISK_DOT: Record<"low" | "medium", string> = {
  low: "bg-skill",
  medium: "bg-amber-500",
}

/** What Jev decided lately, and how sure it must be before the app acts. */
export function JevDecisionsCard({
  jevEnabled,
  levels,
  saving,
  onLevelChange,
}: {
  jevEnabled: boolean
  levels: JevCutoffLevels
  saving: boolean
  onLevelChange: (kind: TunableDecision, level: JevCutoffLevel) => Promise<boolean>
}): React.ReactElement {
  const [data, setData] = React.useState<DecisionLogSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [clearOpen, setClearOpen] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)

  const load = React.useCallback((): void => {
    apiFetch<DecisionLogSnapshot>("/api/settings/ai/jev-decisions")
      .then((next) => {
        setData(next)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : DECISIONS_LOAD_ERROR))
      .finally(() => setRefreshing(false))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  function refresh(): void {
    setRefreshing(true)
    load()
  }

  async function clear(): Promise<void> {
    setClearing(true)
    try {
      setData(await apiFetch<DecisionLogSnapshot>("/api/settings/ai/jev-decisions", { method: "DELETE" }))
      setClearOpen(false)
      toast.success("Decision list cleared")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not clear the list")
    } finally {
      setClearing(false)
    }
  }

  const entries = data?.entries ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" />
          {DECISIONS_TITLE}
        </CardTitle>
        <CardDescription>{DECISIONS_INTRO}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="jev-cutoffs-title" className="space-y-4">
          <div className="space-y-1">
            <h3 id="jev-cutoffs-title" className="text-sm font-semibold">
              {CUTOFFS_TITLE}
            </h3>
            <p className="text-xs text-muted-foreground">{CUTOFFS_INTRO}</p>
          </div>
          {TUNABLE_DECISIONS.map((kind) => (
            <CutoffChoice
              key={kind}
              kind={kind}
              level={levels[kind]}
              disabled={saving}
              summary={data ? summarizeDecisions(entries, kind) : null}
              onPick={(level) => void onLevelChange(kind, level)}
            />
          ))}
          <div className="space-y-1 rounded-lg border border-dashed p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {DECISION_LABELS.preflight}
            </p>
            <p className="text-xs text-muted-foreground">{PREFLIGHT_FIXED}</p>
          </div>
          <p className="text-xs text-muted-foreground">{LEVEL_SAVE_EFFECT}</p>
        </section>

        <section aria-labelledby="jev-recent-title" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="jev-recent-title" className="text-sm font-semibold">
              {RECENT_TITLE}
            </h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setClearOpen(true)}
                disabled={entries.length === 0 || clearing}
              >
                <Trash2 className="h-4 w-4" />
                Clear decisions
              </Button>
            </div>
          </div>
          <RecentDecisions
            data={data}
            error={error}
            jevEnabled={jevEnabled}
            onRetry={refresh}
          />
          <p className="text-xs text-muted-foreground">{DECISIONS_WHERE}</p>
        </section>
      </CardContent>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{CLEAR_DIALOG_TITLE}</DialogTitle>
            <DialogDescription>{CLEAR_EFFECT}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearOpen(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void clear()} disabled={clearing}>
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Clear list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function CutoffChoice({
  kind,
  level,
  disabled,
  summary,
  onPick,
}: {
  kind: TunableDecision
  level: JevCutoffLevel
  disabled: boolean
  summary: DecisionSummary | null
  onPick: (level: JevCutoffLevel) => void
}): React.ReactElement {
  const titleId = `jev-cutoff-${kind}`
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p id={titleId} className="text-sm font-medium">
          {DECISION_LABELS[kind]}
        </p>
        <p className="text-xs text-muted-foreground">{DECISION_HELP[kind]}</p>
      </div>
      <div role="radiogroup" aria-labelledby={titleId} className="grid gap-2 sm:grid-cols-3">
        {JEV_CUTOFF_LEVELS.map((option) => {
          const selected = option === level
          const would = summary ? wouldUseLine(summary, option) : null
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${DECISION_LABELS[kind]}: ${levelLabel(option)}`}
              disabled={disabled}
              onClick={() => {
                if (!selected) onPick(option)
              }}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", RISK_DOT[LEVEL_RISK[option]])} aria-hidden />
                {LEVEL_LABELS[option]}
                <span className="font-normal text-muted-foreground">{percent(JEV_CUTOFF_VALUES[option])}</span>
              </span>
              <span className="text-xs text-muted-foreground">{LEVEL_SUMMARIES[option]}</span>
              {would ? <span className="text-xs text-foreground">{would}</span> : null}
            </button>
          )
        })}
      </div>
      {level === "eager" && HIGH_STAKES.has(kind) ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {EAGER_WARNING}
        </p>
      ) : null}
      {summary ? <p className="text-xs text-muted-foreground">{summaryLine(summary)}</p> : null}
    </div>
  )
}

function formatWhen(at: string): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function RecentDecisions({
  data,
  error,
  jevEnabled,
  onRetry,
}: {
  data: DecisionLogSnapshot | null
  error: string | null
  jevEnabled: boolean
  onRetry: () => void
}): React.ReactElement {
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <span className="text-destructive">{error}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading decisions…</p>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }
  if (data.entries.length === 0) {
    return (
      <div className="space-y-1 rounded-lg border border-dashed px-4 py-6 text-center">
        <p className="text-sm font-medium">{EMPTY_TITLE}</p>
        <p className="text-sm text-muted-foreground">{emptyText(jevEnabled)}</p>
      </div>
    )
  }
  const used = Math.min(100, Math.round((data.entries.length / data.max) * 100))
  return (
    <div className="space-y-2">
      <div className="relative max-h-80 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Jev&apos;s answer</TableHead>
              <TableHead className="whitespace-nowrap">Score / level</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((entry, index) => (
              <TableRow key={`${entry.at}-${index}`}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={new Date(entry.at).toLocaleString()}>
                  {formatWhen(entry.at)}
                </TableCell>
                <TableCell className="text-xs">{DECISION_LABELS[entry.kind]}</TableCell>
                <TableCell className="max-w-40 truncate text-xs" title={entry.choice}>
                  {choiceLabel(entry)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs tabular-nums">
                  {scoreLine(entry)}
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className={cn("cursor-default whitespace-nowrap", OUTCOME_STYLES[entry.outcome])}>
                        {OUTCOME_LABELS[entry.outcome]}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{OUTCOME_HELP[entry.outcome]}</TooltipContent>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-1">
        <div
          role="progressbar"
          aria-label="Decision list size"
          aria-valuemin={0}
          aria-valuemax={data.max}
          aria-valuenow={data.entries.length}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${used}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">{logLimitLine(data.entries.length, data.max)}</p>
      </div>
    </div>
  )
}
