import { cn } from "@/lib/utils"
import type { RunStatus, StepStatus, WorkflowTrigger } from "@/lib/workflows/schema"
import { Badge } from "@/components/ui/badge"

const LABELS: Record<RunStatus | StepStatus, string> = {
  queued: "Queued",
  pending: "Pending",
  running: "Running",
  waiting_approval: "Needs approval",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
}

const TONE: Record<RunStatus | StepStatus, string> = {
  queued: "",
  pending: "",
  running: "border-primary/40 text-primary",
  waiting_approval: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  succeeded: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  failed: "border-destructive/50 text-destructive",
  cancelled: "text-muted-foreground",
  skipped: "text-muted-foreground",
}

export function RunStatusBadge({
  status,
  className,
}: {
  status: RunStatus | StepStatus
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn(TONE[status], className)}>
      {LABELS[status]}
    </Badge>
  )
}

export function triggerLabel(trigger: WorkflowTrigger): string {
  if (trigger.type === "interval") return `Every ${trigger.everyMinutes} min`
  if (trigger.type === "daily") return `Daily at ${trigger.at}`
  return "Manual"
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
}
