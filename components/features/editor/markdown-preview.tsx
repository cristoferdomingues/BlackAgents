"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        Nothing to preview yet.
      </div>
    )
  }
  return (
    <div className="prose-ba h-[420px] overflow-y-auto rounded-md border p-4 scrollbar-thin">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
