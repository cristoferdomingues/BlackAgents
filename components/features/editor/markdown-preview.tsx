"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

/**
 * "panel" is the fixed-height bordered box of the editor; "inline" grows with
 * its content, for chat messages.
 */
export function MarkdownPreview({
  content,
  variant = "panel",
}: {
  content: string
  variant?: "panel" | "inline"
}) {
  const inline = variant === "inline"
  if (!content.trim()) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-sm text-muted-foreground",
          !inline && "h-[420px] rounded-md border"
        )}
      >
        Nothing to preview yet.
      </div>
    )
  }
  return (
    <div
      className={cn(
        "prose-ba",
        inline ? "min-w-0 break-words" : "h-[420px] overflow-y-auto rounded-md border p-4 scrollbar-thin"
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
