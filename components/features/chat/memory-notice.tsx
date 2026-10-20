"use client"

import * as React from "react"
import Link from "next/link"
import { BookmarkPlus, CheckCircle2, Loader2, ScrollText } from "lucide-react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import { factToMemoryDraft, type ConversationMemory } from "@/lib/chat/memory"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Shown above a long chat whose older messages are summarized for the model. */
export function MemoryNotice({
  memory,
  agent,
}: {
  memory: ConversationMemory
  agent?: string
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <div
        className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2"
        data-testid="memory-notice"
      >
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <ScrollText className="h-4 w-4 shrink-0" />
          <span>
            The first {memory.covered} messages are summarized for the assistant, with{" "}
            {memory.facts.length} case fact{memory.facts.length === 1 ? "" : "s"} kept word for word.
          </span>
        </p>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
          View memory
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Chat memory</DialogTitle>
            <DialogDescription>
              The assistant gets these notes instead of the first {memory.covered} messages. The newest
              messages are always sent in full. Your full history stays in this browser.
            </DialogDescription>
          </DialogHeader>
          <section className="space-y-2" aria-label="Case facts">
            <h3 className="text-sm font-medium">Case facts</h3>
            {memory.facts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No facts yet.</p>
            ) : (
              <ul className="space-y-2">
                {memory.facts.map((fact) => (
                  <FactRow key={fact} fact={fact} agent={agent} />
                ))}
              </ul>
            )}
          </section>
          <section className="space-y-2" aria-label="Summary">
            <h3 className="text-sm font-medium">Summary of earlier messages</h3>
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{memory.summary}</p>
          </section>
        </DialogContent>
      </Dialog>
    </>
  )
}

function FactRow({ fact, agent }: { fact: string; agent?: string }): React.ReactElement {
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle")

  async function propose(): Promise<void> {
    setState("sending")
    try {
      await apiFetch("/api/brain/memory", {
        method: "POST",
        body: JSON.stringify(factToMemoryDraft(fact, agent)),
      })
      setState("sent")
      toast.success("Fact sent to the Brain Inbox")
    } catch (err) {
      setState("idle")
      toast.error(err instanceof Error ? err.message : "Could not send this fact to the Inbox")
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-md border p-2 text-sm">
      <span className="min-w-0 break-words">{fact}</span>
      {state === "sent" ? (
        <Link href="/brain" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          In the Inbox
        </Link>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          disabled={state === "sending"}
          onClick={() => void propose()}
          aria-label={`Send to Memory: ${fact}`}
        >
          {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}
          Send to Memory
        </Button>
      )}
    </li>
  )
}
