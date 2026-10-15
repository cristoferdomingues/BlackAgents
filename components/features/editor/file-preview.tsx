"use client"

import * as React from "react"
import { Check, Copy, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { apiFetch, ApiError } from "@/lib/api"
import type { TryDraft } from "@/components/features/editor/try-chat-panel"
import { Button } from "@/components/ui/button"

const PREVIEW_DEBOUNCE_MS = 400

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; relPath: string; content: string }
  | { status: "invalid"; message: string }

/** The exact file Save will write, refreshed while the user types. */
export function FilePreview({
  draft,
  originalName,
}: {
  draft: TryDraft
  originalName?: string
}): React.ReactElement {
  const [state, setState] = React.useState<PreviewState>({ status: "loading" })
  const [copied, setCopied] = React.useState(false)
  const key = JSON.stringify({ input: draft, originalName })

  React.useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      apiFetch<{ relPath: string; content: string }>("/api/artifacts/preview", {
        method: "POST",
        body: key,
        signal: controller.signal,
      })
        .then((data) => setState({ status: "ready", ...data }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setState({
            status: "invalid",
            message: err instanceof ApiError ? err.message : "Could not build the preview",
          })
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  async function copy(content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy")
    }
  }

  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Building preview…
      </p>
    )
  }
  if (state.status === "invalid") {
    return (
      <p className="text-xs text-muted-foreground">
        The preview shows once the form is valid: <span className="text-foreground">{state.message}</span>
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <code className="truncate" title={state.relPath}>
            {state.relPath}
          </code>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Copy file"
          onClick={() => void copy(state.content)}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <pre
        aria-label="File content"
        className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed"
      >
        {state.content}
      </pre>
    </div>
  )
}
