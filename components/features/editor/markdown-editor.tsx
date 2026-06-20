"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { markdown } from "@codemirror/lang-markdown"
import { githubDark, githubLight } from "@uiw/codemirror-theme-github"
import { EditorView } from "@codemirror/view"
import { useTheme } from "next-themes"

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] animate-pulse rounded-md border bg-muted/40" />
  ),
})

const extensions = [markdown(), EditorView.lineWrapping]

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

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
