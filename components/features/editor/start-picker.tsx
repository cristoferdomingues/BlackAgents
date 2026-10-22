"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, FilePlus2, LayoutTemplate, Loader2, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import { STARTER_TEMPLATES, type StarterTemplate } from "@/lib/artifacts/starter-templates"
import type { ArtifactType } from "@/lib/artifacts/types"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const DESCRIBE_PLACEHOLDER: Record<ArtifactType, string> = {
  agent: "e.g. Reviews pull requests for security issues and explains each finding.",
  rule: "e.g. In TypeScript files, never use any and always type exported functions.",
  skill: "e.g. Use when writing database migrations: naming, rollbacks and testing.",
  command: "e.g. Run the reviewer, then the developer to fix what it found.",
}

/** First step for a new artifact: describe it, pick a template, or start blank. */
export function StartPicker({
  type,
  hasProvider,
  providerLoaded,
  drafting,
  onDescribe,
  onTemplate,
  onBlank,
}: {
  type: ArtifactType
  hasProvider: boolean
  providerLoaded: boolean
  drafting: boolean
  onDescribe: (text: string) => void
  onTemplate: (template: StarterTemplate) => void
  onBlank: () => void
}): React.ReactElement {
  const meta = metaForType(type)
  const Icon = meta.icon
  const [text, setText] = React.useState("")
  const templates = STARTER_TEMPLATES[type]
  const lower = meta.label.toLowerCase()

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/${meta.route}`} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Icon className={cn("h-5 w-5", meta.colorClass)} />
        <h1 className="text-lg font-semibold">New {meta.label}</h1>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
        <div className="space-y-1 text-center">
          <h2 className="text-xl font-semibold">How do you want to start?</h2>
          <p className="text-sm text-muted-foreground">You can change everything later.</p>
        </div>

        <section aria-labelledby="start-describe" className="space-y-3 rounded-lg border bg-card p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 id="start-describe" className="text-sm font-semibold">
              Describe it
            </h3>
            <span className="text-xs text-muted-foreground">The assistant writes a first draft.</span>
          </div>
          <Label htmlFor="start-describe-text" className="sr-only">
            What should this {lower} do?
          </Label>
          <Textarea
            id="start-describe-text"
            rows={3}
            value={text}
            placeholder={DESCRIBE_PLACEHOLDER[type]}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim() && hasProvider) {
                e.preventDefault()
                onDescribe(text)
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {providerLoaded && !hasProvider ? (
              <p className="text-xs text-muted-foreground">
                <Link href="/settings/providers" className="underline underline-offset-2">
                  Verify an AI provider
                </Link>{" "}
                to draft with the assistant.
              </p>
            ) : (
              <span />
            )}
            <Button
              type="button"
              size="sm"
              disabled={!text.trim() || !hasProvider || drafting}
              onClick={() => onDescribe(text)}
            >
              {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {drafting ? "Drafting…" : "Draft it"}
            </Button>
          </div>
        </section>

        {templates.length > 0 ? (
          <section aria-labelledby="start-templates" className="space-y-3">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
              <h3 id="start-templates" className="text-sm font-semibold">
                From a template
              </h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  disabled={drafting}
                  onClick={() => onTemplate(template)}
                  className="flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <span className="text-sm font-medium">{template.title}</span>
                  <span className="text-xs text-muted-foreground">{template.summary}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="flex justify-center">
          <Button type="button" variant="ghost" onClick={onBlank} disabled={drafting}>
            <FilePlus2 className="h-4 w-4" />
            Start blank
          </Button>
        </div>
      </div>
    </div>
  )
}
