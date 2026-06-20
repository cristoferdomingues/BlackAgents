"use client"

import Link from "next/link"
import { Check, Circle, Lightbulb, ScrollText } from "lucide-react"

import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import type { ArtifactType } from "@/lib/artifacts/types"
import { STANDARDS_SPEC } from "@/lib/standards/default-standards"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function hasSection(body: string, section: string): boolean {
  const re = new RegExp(`^#{1,4}\\s+${section}\\b`, "im")
  return re.test(body)
}

export function StandardsHints({
  type,
  body,
  onInsertTemplate,
}: {
  type: ArtifactType
  body: string
  onInsertTemplate?: () => void
}) {
  const spec = STANDARDS_SPEC[type]
  const meta = metaForType(type)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            Authoring standards
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{spec.frontmatterNote}</p>

          {spec.requiredSections.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Required sections
              </p>
              <ul className="space-y-1">
                {spec.requiredSections.map((section) => {
                  const present = hasSection(body, section)
                  return (
                    <li key={section} className="flex items-center gap-2">
                      {present ? (
                        <Check className="h-3.5 w-3.5 text-skill" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                      <span
                        className={cn(
                          present
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {section}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {onInsertTemplate ? (
            <button
              type="button"
              onClick={onInsertTemplate}
              className="text-xs font-medium text-primary hover:underline"
            >
              Insert {meta.label.toLowerCase()} template into body
            </button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Lightbulb className="h-4 w-4 text-rule" />
            Avoid
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {spec.antiPatterns.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-rule">·</span>
                {item}
              </li>
            ))}
          </ul>
          <Link
            href="/standards"
            className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
          >
            View full standards →
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
