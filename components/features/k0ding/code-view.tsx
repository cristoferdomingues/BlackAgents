"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { yaml } from "@codemirror/lang-yaml"
import { githubDark, githubLight } from "@uiw/codemirror-theme-github"
import { useTheme } from "next-themes"
import type { Extension } from "@codemirror/state"

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-muted/40" />,
})

function languageFor(filePath: string): Extension[] {
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase()
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return [javascript({ typescript: ext === "ts" || ext === "tsx", jsx: ext === "tsx" || ext === "jsx" })]
  }
  if (ext === "json") return [json()]
  if (ext === "md" || ext === "mdx") return [markdown()]
  if (ext === "yml" || ext === "yaml") return [yaml()]
  return []
}

/** Read-only code view. The user edits only by approving a staged change. */
export function CodeView({ path, content }: { path: string; content: string }): React.ReactElement {
  const { resolvedTheme } = useTheme()
  return (
    <div className="h-full min-h-0">
      <CodeMirror
        value={content}
        editable={false}
        readOnly
        theme={resolvedTheme === "light" ? githubLight : githubDark}
        extensions={languageFor(path)}
        height="100%"
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  )
}
