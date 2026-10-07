"use client"

import * as React from "react"
import { Loader2, Send, ThumbsDown, ThumbsUp } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { FeedbackResult } from "@/lib/brain/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/**
 * Thumbs up/down + optional comment. The Second Brain decides whether it is
 * worth a memory note or an artifact change; anything it proposes lands in
 * the Brain inbox for review — nothing is applied automatically.
 */
export function FeedbackBar({
  source,
  agent,
  userMessage,
  reply,
  provider,
  model,
  runId,
  className,
}: {
  source: "chat" | "run"
  agent?: string
  userMessage: string
  reply: string
  provider: string
  model: string
  runId?: string
  className?: string
}) {
  const [rating, setRating] = React.useState<"up" | "down" | null>(null)
  const [comment, setComment] = React.useState("")
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle")

  async function submit(nextRating: "up" | "down", text: string) {
    setState("sending")
    try {
      const result = await apiFetch<FeedbackResult>("/api/brain/feedback", {
        method: "POST",
        body: JSON.stringify({
          source,
          agent,
          rating: nextRating,
          comment: text.trim() || undefined,
          userMessage: userMessage.slice(0, 4_000),
          reply: reply.slice(0, 8_000),
          provider: provider || undefined,
          model: model || undefined,
          runId,
        }),
      })
      setState("sent")
      if (result.kind === "proposed") toast.success("Saved. A learning proposal is waiting in the Brain inbox.")
      else toast.success("Thanks for the feedback.")
    } catch (err) {
      setState("idle")
      toast.error(err instanceof Error ? err.message : "Could not send feedback")
    }
  }

  if (state === "sent") {
    return <p className={cn("text-xs text-muted-foreground", className)}>Feedback saved.</p>
  }

  return (
    <div className={cn("space-y-2 text-left", className)}>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant={rating === "up" ? "secondary" : "ghost"}
          className="h-7 w-7"
          aria-label="Good answer"
          aria-pressed={rating === "up"}
          disabled={state === "sending"}
          onClick={() => {
            setRating("up")
            void submit("up", comment)
          }}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant={rating === "down" ? "secondary" : "ghost"}
          className="h-7 w-7"
          aria-label="Bad answer"
          aria-pressed={rating === "down"}
          disabled={state === "sending"}
          onClick={() => setRating("down")}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </Button>
        {state === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      {rating === "down" && state === "idle" ? (
        <div className="flex items-end gap-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="What should be different next time?"
            aria-label="Feedback comment"
            className="min-h-[2.5rem] text-xs"
          />
          <Button
            size="icon"
            aria-label="Send feedback"
            onClick={() => submit("down", comment)}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
