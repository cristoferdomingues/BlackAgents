"use client"

import * as React from "react"
import { Loader2, RotateCcw, Send, X } from "lucide-react"
import { toast } from "sonner"

import { streamPost } from "@/lib/sse-client"
import { chatDoneEventSchema, chatErrorEventSchema } from "@/lib/assistant/chat-events"
import { applyChatEvent, EMPTY_LIVE, type LiveTurn } from "@/lib/assistant/live-turn"
import type { ArtifactType, Platform } from "@/lib/artifacts/types"
import { ThinkingPanel } from "@/components/features/chat/thinking-panel"
import { ApprovalCard } from "@/components/features/approvals/approval-card"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import type { ResolvedProviderModel } from "@/components/features/editor/use-assistant-provider"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface TryTurn {
  role: "user" | "assistant"
  content: string
}

/** The unsaved artifact as the chat request's `draft` field. */
export interface TryDraft {
  type: ArtifactType
  platform: Platform
  name: string
  description: string
  body: string
  extra: Record<string, unknown>
}

const PLACEHOLDER: Record<ArtifactType, string> = {
  agent: "Give this agent a task…",
  rule: "Ask something this rule should change…",
  skill: "Ask something this skill should help with…",
  command: "Ask to run this command…",
}

/** A small chat that uses the editor's unsaved draft. Nothing is saved. */
export function TryChatPanel({
  type,
  name,
  getDraft,
  resolveProvider,
  onClose,
}: {
  type: ArtifactType
  name: string
  getDraft: () => TryDraft
  resolveProvider: () => ResolvedProviderModel | null
  onClose: () => void
}): React.ReactElement {
  const [turns, setTurns] = React.useState<TryTurn[]>([])
  const [live, setLive] = React.useState<LiveTurn>(EMPTY_LIVE)
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [allowFileWrites, setAllowFileWrites] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => () => abortRef.current?.abort(), [])
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [turns, live])

  async function send(): Promise<void> {
    const content = input.trim()
    if (!content || sending) return
    const resolved = resolveProvider()
    if (!resolved) {
      toast.error("Verify an AI provider to try this")
      return
    }
    if (!resolved.model) {
      toast.error(`Pick a model for ${resolved.label} in the Assistant first, then try again`)
      return
    }
    const next: TryTurn[] = [...turns, { role: "user", content }]
    setTurns(next)
    setInput("")
    setSending(true)
    setLive(EMPTY_LIVE)
    const controller = new AbortController()
    abortRef.current = controller
    const outcome: { reply: string | null; error: string | null } = { reply: null, error: null }
    try {
      let current = EMPTY_LIVE
      await streamPost(
        "/api/chat",
        {
          provider: resolved.provider,
          model: resolved.model,
          messages: next,
          draft: getDraft(),
          allowFileWrites,
        },
        (event) => {
          if (event.event === "done") {
            const parsed = chatDoneEventSchema.safeParse(event.data)
            if (parsed.success) outcome.reply = parsed.data.content
            else outcome.error = "The assistant sent an unreadable reply"
            return
          }
          if (event.event === "error") {
            const parsed = chatErrorEventSchema.safeParse(event.data)
            outcome.error = parsed.success ? parsed.data.message : "The assistant failed"
            return
          }
          current = applyChatEvent(current, event)
          setLive(current)
        },
        controller.signal
      )
      if (outcome.error) throw new Error(outcome.error)
      if (outcome.reply === null) throw new Error("The assistant stopped before answering")
      setTurns([...next, { role: "assistant", content: outcome.reply }])
    } catch (err) {
      if (controller.signal.aborted) return
      toast.error(err instanceof Error ? err.message : "The assistant failed")
      setTurns(turns)
      setInput(content)
    } finally {
      setSending(false)
      setLive(EMPTY_LIVE)
    }
  }

  function reset(): void {
    abortRef.current?.abort()
    setTurns([])
    setLive(EMPTY_LIVE)
    setSending(false)
  }

  const label = name.trim() || `this ${type}`

  return (
    <section aria-label="Try in chat" className="flex h-full min-h-[420px] flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Try {label}</h2>
          <p className="text-[11px] text-muted-foreground">Uses your unsaved changes. Nothing is saved.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={reset}
            disabled={turns.length === 0 && !sending}
            aria-label="Start over"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close try chat">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {turns.length === 0 && !sending ? (
          <p className="text-xs text-muted-foreground">
            Send a message to see how {label} behaves. Edit the form and send again to compare.
          </p>
        ) : null}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="ml-6 rounded-lg bg-muted px-3 py-2 text-sm">
              {turn.content}
            </div>
          ) : (
            <div key={i} className="text-sm">
              <MarkdownPreview content={turn.content} />
            </div>
          )
        )}
        {sending ? (
          <div className="space-y-2">
            <ThinkingPanel
              name={type === "agent" ? name : undefined}
              steps={live.thinking}
              waitingForApproval={live.approvals.length > 0}
            />
            {live.approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                rememberLabel="Allow this exact call for this message"
                onResolved={(_approved, permission) => {
                  if (permission === "session") setAllowFileWrites(true)
                }}
              />
            ))}
            {live.content ? <MarkdownPreview content={live.content} /> : null}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t p-2">
        <Textarea
          aria-label="Message"
          rows={2}
          value={input}
          placeholder={PLACEHOLDER[type]}
          className="min-h-0 resize-none text-sm"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          onClick={() => void send()}
          disabled={!input.trim() || sending}
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </section>
  )
}
