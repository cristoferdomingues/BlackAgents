"use client"

import * as React from "react"

import { metaForType } from "@/lib/artifacts/constants"
import type { ArtifactType } from "@/lib/artifacts/types"
import { cn } from "@/lib/utils"

export interface ChatMention {
  type: ArtifactType
  name: string
  description?: string
}

export function MentionMenu({
  items,
  activeIndex,
  emptyLabel,
  onPick,
  onHighlight,
}: {
  items: ChatMention[]
  activeIndex: number
  emptyLabel: string
  onPick: (item: ChatMention) => void
  onHighlight: (index: number) => void
}): React.ReactElement {
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    option?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  return (
    <div
      id="assistant-mentions"
      ref={listRef}
      role="listbox"
      aria-label="Workspace artifacts"
      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full max-w-lg overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        items.map((item, index) => {
          const meta = metaForType(item.type)
          const showHeader = index === 0 || items[index - 1]?.type !== item.type
          const Icon = meta.icon
          return (
            <React.Fragment key={`${item.type}:${item.name}`}>
              {showHeader ? (
                <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  {meta.labelPlural}
                </p>
              ) : null}
              <button
                type="button"
                role="option"
                id={`assistant-mention-${index}`}
                data-index={index}
                aria-selected={index === activeIndex}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                  index === activeIndex && "bg-accent text-accent-foreground"
                )}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onPick(item)
                }}
                onMouseEnter={() => onHighlight(index)}
              >
                <Icon className={cn("h-4 w-4 shrink-0", meta.colorClass)} />
                <span className="truncate font-medium">{item.name}</span>
                {item.description ? (
                  <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                ) : null}
              </button>
            </React.Fragment>
          )
        })
      )}
    </div>
  )
}
