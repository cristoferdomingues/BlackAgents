import * as React from "react"

import { cn } from "@/lib/utils"

/** A numbered block of the artifact editor ("1 · Identity"). */
export function EditorSection({
  id,
  step,
  title,
  description,
  actions,
  children,
  className,
}: {
  id: string
  step: number
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  const headingId = `${id}-heading`
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-6 space-y-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
          >
            {step}
          </span>
          <div>
            <h2 id={headingId} className="text-sm font-semibold">
              {title}
            </h2>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2 pl-9 sm:pl-0">{actions}</div> : null}
      </div>
      <div className="pl-9">{children}</div>
    </section>
  )
}
