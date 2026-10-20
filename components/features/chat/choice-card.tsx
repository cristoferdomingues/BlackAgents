"use client"

import * as React from "react"
import { Check, ListChecks, PenLine, Send } from "lucide-react"

import { cn } from "@/lib/utils"
import { formatChoiceAnswer, MAX_OTHER_ANSWER, type ChoicePrompt } from "@/lib/llm/choices"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const OTHER = "other"

/** Text with `code` spans, as models often write option text. */
function InlineText({ text }: { text: string }): React.ReactElement {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

export function ChoiceCard({
  prompt,
  onAnswer,
  disabled,
}: {
  prompt: ChoicePrompt
  onAnswer: (answer: string) => void
  /** True while a reply is streaming, or once this question is no longer the latest turn. */
  disabled: boolean
}): React.ReactElement {
  const [selected, setSelected] = React.useState<string[]>([])
  const [other, setOther] = React.useState("")
  const otherRef = React.useRef<HTMLInputElement>(null)
  const otherOn = selected.includes(OTHER)
  const answer = formatChoiceAnswer(
    prompt,
    selected.filter((label) => label !== OTHER),
    otherOn ? other : ""
  )
  const role = prompt.multiple ? "checkbox" : "radio"

  function toggle(label: string): void {
    setSelected((current) => {
      if (!prompt.multiple) return current.includes(label) ? [] : [label]
      return current.includes(label) ? current.filter((l) => l !== label) : [...current, label]
    })
    if (label === OTHER) requestAnimationFrame(() => otherRef.current?.focus())
  }

  function submit(): void {
    if (!answer || disabled) return
    onAnswer(answer)
  }

  return (
    <div className="rounded-lg border bg-card p-3 text-left" data-testid="choice-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          <p className="truncate text-sm font-medium">{prompt.question ?? "Choose an answer"}</p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {prompt.multiple ? "Pick one or more" : "Pick one"}
        </Badge>
      </div>

      <div
        role={prompt.multiple ? "group" : "radiogroup"}
        aria-label={prompt.question ?? "Answer options"}
        className="mt-3 space-y-1.5"
      >
        {prompt.options.map((option) => {
          const on = selected.includes(option.label)
          return (
            <button
              key={option.label}
              type="button"
              role={role}
              aria-checked={on}
              disabled={disabled}
              onClick={() => toggle(option.label)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                "hover:bg-accent disabled:pointer-events-none disabled:opacity-60",
                on && "border-primary bg-primary/10"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-semibold",
                  prompt.multiple ? "rounded" : "rounded-full",
                  on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
                aria-hidden="true"
              >
                {on ? <Check className="h-3 w-3" /> : option.label}
              </span>
              <span className="min-w-0 pt-px">
                <InlineText text={option.text} />
              </span>
            </button>
          )
        })}

        <div
          className={cn(
            "rounded-md border border-dashed px-3 py-2 transition-colors",
            otherOn && "border-primary bg-primary/10"
          )}
        >
          <button
            type="button"
            role={role}
            aria-checked={otherOn}
            disabled={disabled}
            onClick={() => toggle(OTHER)}
            className="flex w-full items-center gap-2.5 text-left text-sm disabled:pointer-events-none disabled:opacity-60"
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center border",
                prompt.multiple ? "rounded" : "rounded-full",
                otherOn ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
              aria-hidden="true"
            >
              {otherOn ? <Check className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
            </span>
            Other — write your own answer
          </button>
          {otherOn ? (
            <Input
              ref={otherRef}
              className="mt-2 h-8 text-sm"
              value={other}
              maxLength={MAX_OTHER_ANSWER}
              disabled={disabled}
              placeholder="Type your answer"
              aria-label="Your own answer"
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          ) : null}
        </div>
      </div>

      <Button size="sm" className="mt-3 w-full" disabled={disabled || !answer} onClick={submit}>
        <Send className="h-4 w-4" />
        Send answer
      </Button>
    </div>
  )
}
