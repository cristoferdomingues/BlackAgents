"use client"

import * as React from "react"
import { X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

export function GlobsInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (value: string[]) => void
}) {
  const [draft, setDraft] = React.useState("")

  function add() {
    const v = draft.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft("")
  }

  return (
    <div className="space-y-2">
      <Input
        value={draft}
        placeholder="e.g. **/src/**/*.ts — press Enter to add"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((glob) => (
            <Badge key={glob} variant="secondary" className="gap-1 font-mono">
              {glob}
              <button
                type="button"
                onClick={() => onChange(value.filter((g) => g !== glob))}
                aria-label={`Remove ${glob}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
