"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Circle, MessageSquareText } from "lucide-react"

import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import { firstSentence, type EditorCheck } from "@/lib/artifacts/editor-helpers"
import type { ArtifactType } from "@/lib/artifacts/types"
import { STANDARDS_SPEC } from "@/lib/standards/default-standards"
import { FilePreview } from "@/components/features/editor/file-preview"
import type { TryDraft } from "@/components/features/editor/try-chat-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** Sticky summary of the artifact: what it is, live checks, the file, and tips. */
export function EditorSidePanel({
  type,
  name,
  description,
  facts,
  checks,
  draft,
  originalName,
  canTry,
  tryHint,
  onTry,
  onInsertTemplate,
}: {
  type: ArtifactType
  name: string
  description: string
  /** Short labels such as "Read only" or "Always applies". */
  facts: string[]
  checks: EditorCheck[]
  draft: TryDraft
  originalName?: string
  canTry: boolean
  tryHint: string
  onTry: () => void
  onInsertTemplate?: () => void
}): React.ReactElement {
  const meta = metaForType(type)
  const Icon = meta.icon
  const passed = checks.filter((c) => c.ok).length
  const blocking = checks.some((c) => !c.ok && c.severity === "error")
  const percent = checks.length === 0 ? 100 : Math.round((passed / checks.length) * 100)
  const spec = STANDARDS_SPEC[type]

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className={cn("h-4 w-4", meta.colorClass)} />
          </span>
          <div className="min-w-0">
            <p className={cn("truncate text-sm font-semibold", !name.trim() && "text-muted-foreground")}>
              {name.trim() || `Untitled ${meta.label.toLowerCase()}`}
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {description.trim() ? firstSentence(description) : "No description yet."}
            </p>
          </div>
        </div>
        {facts.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {facts.map((fact) => (
              <Badge key={fact} variant="secondary" className="font-normal">
                {fact}
              </Badge>
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onTry}
          disabled={!canTry}
          title={tryHint}
        >
          <MessageSquareText className="h-4 w-4" />
          Try in chat
        </Button>
        {!canTry ? <p className="text-[11px] text-muted-foreground">{tryHint}</p> : null}
      </div>

      <Tabs defaultValue="checks">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="checks" className="text-xs">
            Checks
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                blocking ? "bg-destructive/15 text-destructive" : "bg-muted-foreground/15"
              )}
            >
              {passed}/{checks.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="file" className="text-xs">
            File
          </TabsTrigger>
          <TabsTrigger value="tips" className="text-xs">
            Tips
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checks" className="space-y-3">
          <div
            role="progressbar"
            aria-label="Checks passed"
            aria-valuemin={0}
            aria-valuemax={checks.length}
            aria-valuenow={passed}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full transition-all", blocking ? "bg-amber-500" : "bg-skill")}
              style={{ width: `${percent}%` }}
            />
          </div>
          <ul aria-label="Checks" className="space-y-2">
            {checks.map((check) => (
              <li key={check.id} className="flex gap-2 text-sm">
                {check.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-skill" aria-label="Passed" />
                ) : check.severity === "error" ? (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Needed" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-label="Advice" />
                )}
                <div className="min-w-0">
                  <p className={cn(check.ok && "text-muted-foreground")}>{check.label}</p>
                  {!check.ok && check.hint ? (
                    <p className="text-xs text-muted-foreground">{check.hint}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {onInsertTemplate && checks.some((c) => c.id.startsWith("section:") && !c.ok) ? (
            <button
              type="button"
              onClick={onInsertTemplate}
              className="text-xs font-medium text-primary hover:underline"
            >
              Insert the {meta.label.toLowerCase()} template into the instructions
            </button>
          ) : null}
        </TabsContent>

        <TabsContent value="file">
          <FilePreview draft={draft} originalName={originalName} />
        </TabsContent>

        <TabsContent value="tips" className="space-y-3 text-sm">
          <p className="text-muted-foreground">{spec.frontmatterNote}</p>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avoid</p>
            <ul className="space-y-1.5 text-muted-foreground">
              {spec.antiPatterns.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-rule" aria-hidden>
                    ·
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <Link href="/standards" className="inline-block text-xs font-medium text-primary hover:underline">
            View full standards →
          </Link>
        </TabsContent>
      </Tabs>
    </div>
  )
}
