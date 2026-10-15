"use client"

import * as React from "react"
import { Loader2, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ValidationResult } from "@/lib/llm/validation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function severityClass(severity: "error" | "warning" | "info"): string {
  switch (severity) {
    case "error":
      return "text-destructive"
    case "warning":
      return "text-amber-500"
    default:
      return "text-muted-foreground"
  }
}

export function DeleteArtifactDialog({
  open,
  onOpenChange,
  label,
  name,
  deleting,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  name: string
  deleting: boolean
  onDelete: () => void
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {label.toLowerCase()}?</DialogTitle>
          <DialogDescription>
            This permanently removes <code>{name}</code> from disk. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ValidationDialog({
  open,
  onOpenChange,
  validation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  validation: ValidationResult | null
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assistant review</DialogTitle>
          <DialogDescription>
            {validation?.summary
              ? validation.summary
              : "The assistant reviewed this artifact against the authoring standards. Findings are suggestions — nothing was changed."}
          </DialogDescription>
        </DialogHeader>
        {validation && validation.findings.length > 0 ? (
          <ul className="space-y-3">
            {validation.findings.map((f, i) => (
              <li key={i} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-wide",
                      severityClass(f.severity)
                    )}
                  >
                    {f.severity}
                  </span>
                  {f.section ? <span className="text-xs text-muted-foreground">· {f.section}</span> : null}
                </div>
                <p className="mt-1 text-sm">{f.message}</p>
                {f.suggestion ? (
                  <p className="mt-1 text-xs text-muted-foreground">Suggestion: {f.suggestion}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No issues found — the artifact looks consistent with the standards.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
