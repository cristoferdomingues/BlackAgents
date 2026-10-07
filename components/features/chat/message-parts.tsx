"use client"

import * as React from "react"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Terminal,
  Wand2,
  XCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import type { NormalizedDraft } from "@/lib/llm/draft"
import type { ToolExecutionTrace } from "@/lib/mcp/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export function ToolExecutionsSection({ traces }: { traces: ToolExecutionTrace[] }) {
  const [open, setOpen] = React.useState(false)
  const totalDuration = traces.reduce((acc, t) => acc + (t.durationMs ?? 0), 0)
  const hasError = traces.some((t) => t.error)

  return (
    <div className="rounded-lg border bg-muted/30 text-left text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <div className="flex items-center gap-2 font-medium">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-foreground">
            {traces.length === 1
              ? `Executed tool: ${traces[0].tool}`
              : `Executed ${traces.length} tools`}
          </span>
          {totalDuration > 0 ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
              {totalDuration}ms
            </Badge>
          ) : null}
          {hasError ? (
            <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
              Errors
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span>{open ? "Hide" : "Details"}</span>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {open ? (
        <div className="space-y-2 border-t bg-background/50 p-2.5">
          {traces.map((trace, idx) => (
            <ToolTraceCard key={trace.id ?? idx} trace={trace} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ToolTraceCard({ trace }: { trace: ToolExecutionTrace }) {
  const [expanded, setExpanded] = React.useState(false)
  const isError = Boolean(trace.error)

  return (
    <div className="rounded border bg-card/60 p-2 font-mono text-[11px]">
      <div
        className="flex cursor-pointer items-center justify-between gap-2"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isError ? (
            <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          )}
          <span className="font-semibold text-foreground truncate">
            {trace.tool}
          </span>
          {trace.server ? (
            <span className="text-muted-foreground text-[10px]">
              ({trace.server})
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground shrink-0 text-[10px]">
          {trace.durationMs !== undefined ? <span>{trace.durationMs}ms</span> : null}
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </div>
      </div>

      {expanded ? (
        <div className="mt-2 space-y-1.5 border-t pt-2 text-[10px]">
          {trace.args && Object.keys(trace.args).length > 0 ? (
            <div>
              <span className="text-muted-foreground font-semibold block mb-0.5 font-sans">
                Arguments:
              </span>
              <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-1.5 text-foreground">
                {JSON.stringify(trace.args, null, 2)}
              </pre>
            </div>
          ) : null}

          <div>
            <span className="text-muted-foreground font-semibold block mb-0.5 font-sans">
              {isError ? "Error:" : "Result:"}
            </span>
            <pre
              className={cn(
                "max-h-48 overflow-auto rounded p-1.5",
                isError
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted/60 text-foreground"
              )}
            >
              {isError
                ? trace.error
                : typeof trace.result === "string"
                  ? trace.result
                  : JSON.stringify(trace.result, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AgentAvatar({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20",
        className
      )}
      aria-label={`${name} avatar`}
      title={name}
    >
      <span className="text-xs font-semibold" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
    </div>
  )
}

export function DraftCard({
  draft,
  onOpen,
}: {
  draft: NormalizedDraft
  onOpen: (draft: NormalizedDraft) => void
}) {
  const meta = metaForType(draft.type)
  const Icon = meta.icon
  return (
    <div className="rounded-lg border bg-card p-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", meta.colorClass)} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{draft.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {draft.description}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {meta.label}
        </Badge>
      </div>
      <Button
        size="sm"
        className="mt-3 w-full"
        onClick={() => onOpen(draft)}
      >
        <Wand2 className="h-4 w-4" />
        Open in editor
      </Button>
    </div>
  )
}
