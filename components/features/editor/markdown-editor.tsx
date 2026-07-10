"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { markdown } from "@codemirror/lang-markdown"
import { githubDark, githubLight } from "@uiw/codemirror-theme-github"
import { EditorView } from "@codemirror/view"
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { useTheme } from "next-themes"

import type { ArtifactType } from "@/lib/artifacts/types"
import { mentionToken } from "@/lib/artifacts/mentions"

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] animate-pulse rounded-md border bg-muted/40" />
  ),
})

export interface MentionItem {
  type: ArtifactType
  name: string
  description?: string
}

const SECTION_RANK: Record<ArtifactType, number> = {
  agent: 0,
  command: 1,
  rule: 2,
  skill: 3,
}
const SECTION_LABEL: Record<ArtifactType, string> = {
  agent: "Agents",
  command: "Commands",
  rule: "Rules",
  skill: "Skills",
}

/** Completion source that offers workspace artifacts, grouped by type, on `@`. */
function mentionSource(items: MentionItem[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const token = context.matchBefore(/@[\w:-]*/)
    if (!token) return null
    // Don't pop up on a bare `@` unless the user is actually typing a mention.
    if (token.from === token.to && !context.explicit) return null

    const options: Completion[] = items.map((item) => ({
      // `label` drives fuzzy filtering; prefix with `@` so it aligns with the
      // matched text. `displayLabel` keeps the visible entry clean.
      label: `@${item.name}`,
      displayLabel: item.name,
      detail: item.description,
      section: { name: SECTION_LABEL[item.type], rank: SECTION_RANK[item.type] },
      type: item.type,
      apply: `${mentionToken(item.type, item.name)} `,
    }))

    return { from: token.from, options, validFor: /^@[\w:-]*$/ }
  }
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  mentions = [],
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mentions?: MentionItem[]
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const extensions = React.useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      autocompletion({
        override: [mentionSource(mentions)],
        icons: false,
        activateOnTyping: true,
      }),
    ],
    [mentions]
  )

  return (
    <div className="overflow-hidden rounded-md border">
      <CodeMirror
        value={value}
        onChange={onChange}
        theme={isDark ? githubDark : githubLight}
        extensions={extensions}
        placeholder={placeholder}
        height="420px"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
        }}
      />
    </div>
  )
}
