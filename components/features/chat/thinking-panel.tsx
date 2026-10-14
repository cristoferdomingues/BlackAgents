"use client"

import * as React from "react"
import { Brain, CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { thinkingHeadline, type ThinkingStep } from "@/lib/assistant/thinking"

function useElapsedSeconds(): number {
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  return seconds
}

export function PulsingBrain({ active = true }: { active?: boolean }) {
  return (
    <span className="relative flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden="true">
      {active ? (
        <span className="absolute inset-0 rounded-full bg-primary/30 motion-safe:animate-ping" />
      ) : null}
      <span
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/40",
          active && "motion-safe:animate-pulse"
        )}
      >
        <Brain className="h-4 w-4 text-primary" />
      </span>
    </span>
  )
}

function StepIcon({ step }: { step: ThinkingStep }) {
  if (step.kind !== "tool") {
    return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
  }
  if (step.status === "running") {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
  }
  if (step.status === "failed") {
    return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
  }
  return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
}

function StepRow({ step }: { step: ThinkingStep }) {
  return (
    <li className="flex gap-2">
      <StepIcon step={step} />
      {step.kind === "tool" ? (
        <div className="min-w-0 flex-1">
          <span className="font-medium text-foreground">{step.tool}</span>
          {step.detail ? (
            <span className="ml-1.5 break-all font-mono text-[11px] text-muted-foreground">
              {step.detail}
            </span>
          ) : null}
          {step.durationMs !== undefined && step.status !== "running" ? (
            <span className="ml-1.5 text-[10px] text-muted-foreground">{step.durationMs}ms</span>
          ) : null}
        </div>
      ) : (
        <p
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words",
            step.kind === "reasoning" ? "italic text-muted-foreground" : "text-foreground/80"
          )}
        >
          {step.text}
        </p>
      )}
    </li>
  )
}

/** Live "what the assistant is thinking" panel: a pulsing brain plus its steps. */
export function ThinkingPanel({
  name,
  steps,
  waitingForApproval,
}: {
  name?: string
  steps: ThinkingStep[]
  waitingForApproval: boolean
}) {
  const [open, setOpen] = React.useState(true)
  const seconds = useElapsedSeconds()
  const listRef = React.useRef<HTMLOListElement>(null)
  const headline = waitingForApproval ? "Waiting for your approval" : thinkingHeadline(steps)

  React.useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [steps, open])

  return (
    <div className="overflow-hidden rounded-lg border border-primary/30 bg-primary/5 text-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={steps.length === 0}
        aria-expanded={steps.length > 0 ? open : undefined}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors enabled:hover:bg-primary/10"
      >
        <PulsingBrain active={!waitingForApproval} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {waitingForApproval ? "Paused" : `${name ?? "Assistant"} is thinking…`}
          </p>
          {headline ? (
            <p className="truncate text-xs text-muted-foreground">{headline}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{seconds}s</span>
        {steps.length > 0 ? (
          open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )
        ) : null}
      </button>
      {open && steps.length > 0 ? (
        <ol
          ref={listRef}
          aria-label="Thinking steps"
          className="scrollbar-thin max-h-64 space-y-2 overflow-y-auto border-t border-primary/20 px-3 py-2 text-xs"
        >
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ol>
      ) : null}
    </div>
  )
}
