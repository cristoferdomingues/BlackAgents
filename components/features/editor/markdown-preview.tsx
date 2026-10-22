"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { conceptLinkTarget } from "@/lib/knowledge/links"
import { cn } from "@/lib/utils"

/**
 * "panel" is the fixed-height bordered box of the editor; "inline" grows with
 * its content, for chat messages; "reader" grows too, with larger text for long documents.
 */
export function MarkdownPreview({
  content,
  variant = "panel",
  fromId,
  openConcept,
}: {
  content: string
  variant?: "panel" | "inline" | "reader"
  /** Concept that contains this markdown, so relative links can open another concept. */
  fromId?: string
  openConcept?: (id: string) => void
}) {
  const inline = variant !== "panel"
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
        variant === "reader" && "prose-reader",
        inline ? "min-w-0 break-words" : "h-[420px] overflow-y-auto rounded-md border p-4 scrollbar-thin"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={
          openConcept && fromId
            ? {
                a: ({ href, children }) => {
                  const id = href ? conceptLinkTarget(fromId, href) : null
                  if (!id) {
                    const external = Boolean(href && /^[a-z]+:/i.test(href))
                    return (
                      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
                        {children}
                      </a>
                    )
                  }
                  return (
                    <button type="button" className="text-primary underline" onClick={() => openConcept(id)}>
                      {children}
                    </button>
                  )
                },
              }
            : undefined
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
