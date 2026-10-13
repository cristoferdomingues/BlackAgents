"use client"

import * as React from "react"
import { Loader2, X, Youtube } from "lucide-react"

import { ApiError, apiFetch } from "@/lib/api"
import { AttachmentError, manualYouTubeAttachment } from "@/lib/chat/attachments"
import {
  MAX_YOUTUBE_SOURCES,
  NO_CAPTIONS_MESSAGE,
  parseYouTubeUrl,
  type YouTubeDraftSource,
  type YouTubeSource,
} from "@/lib/sources/youtube"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type SourceCard =
  | { id: string; status: "loading"; url: string; videoId: string }
  | {
      id: string
      status: "ready"
      url: string
      videoId: string
      title: string
      channel: string
      transcript: string
      truncated: boolean
      manual: boolean
    }
  | { id: string; status: "error"; url: string; videoId: string; message: string; paste: string }

function readySources(items: SourceCard[]): YouTubeDraftSource[] {
  return items
    .filter((item): item is Extract<SourceCard, { status: "ready" }> => item.status === "ready")
    .map((item) => ({
      videoId: item.videoId,
      url: item.url,
      title: item.title,
      channel: item.channel,
      transcript: item.transcript,
    }))
}

export function YouTubeSourcesField({
  onReadyChange,
}: {
  onReadyChange: (sources: YouTubeDraftSource[]) => void
}): React.ReactElement {
  const [url, setUrl] = React.useState("")
  const [inputError, setInputError] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<SourceCard[]>([])
  const readyKey = items
    .filter((item) => item.status === "ready")
    .map((item) => `${item.videoId}:${item.transcript.length}`)
    .join("|")

  React.useEffect(() => {
    onReadyChange(readySources(items))
  }, [readyKey, items, onReadyChange])

  function remove(id: string): void {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  async function addLink(): Promise<void> {
    const submitted = url.trim()
    const videoId = parseYouTubeUrl(submitted)
    if (!videoId) {
      setInputError("Paste a YouTube link")
      return
    }
    if (items.some((item) => item.videoId === videoId)) {
      setInputError("That video is already added")
      return
    }
    if (items.length >= MAX_YOUTUBE_SOURCES) {
      setInputError(`Add at most ${MAX_YOUTUBE_SOURCES} videos`)
      return
    }
    const id = crypto.randomUUID()
    setItems((current) => [...current, { id, status: "loading", url: submitted, videoId }])
    setUrl("")
    setInputError(null)
    try {
      const source = await apiFetch<YouTubeSource>("/api/sources/youtube", {
        method: "POST",
        body: JSON.stringify({
          url: submitted,
          language: typeof navigator === "undefined" ? undefined : navigator.language,
        }),
      })
      setItems((current) => {
        if (!current.some((item) => item.id === id)) return current
        return current.map((item) =>
          item.id === id
            ? {
                id,
                status: "ready" as const,
                url: source.url,
                videoId: source.videoId,
                title: source.title,
                channel: source.channel,
                transcript: source.transcript,
                truncated: source.truncated,
                manual: false,
              }
            : item
        )
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not read this video"
      setItems((current) => {
        if (!current.some((item) => item.id === id)) return current
        return current.map((item) =>
          item.id === id
            ? { id, status: "error" as const, url: submitted, videoId, message, paste: "" }
            : item
        )
      })
    }
  }

  function applyTranscript(id: string): void {
    const item = items.find((entry) => entry.id === id)
    if (!item || item.status !== "error") return
    try {
      const attachment = manualYouTubeAttachment(item.videoId, item.paste)
      setItems((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                id,
                status: "ready" as const,
                url: attachment.url,
                videoId: attachment.videoId,
                title: attachment.title,
                channel: attachment.channel,
                transcript: attachment.transcript,
                truncated: false,
                manual: true,
              }
            : entry
        )
      )
    } catch (err) {
      const message = err instanceof AttachmentError ? err.message : "Could not use that transcript"
      setItems((current) =>
        current.map((entry) => (entry.id === id && entry.status === "error" ? { ...entry, message } : entry))
      )
    }
  }

  return (
    <section className="space-y-3" aria-label="YouTube sources">
      <div className="space-y-1">
        <Label htmlFor="skill-youtube-url">YouTube videos</Label>
        <p className="text-xs text-muted-foreground">
          Add a link. The assistant reads the captions and drafts this skill.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="skill-youtube-url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setInputError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void addLink()
            }
          }}
          placeholder="https://www.youtube.com/watch?v=…"
          spellCheck={false}
          disabled={items.length >= MAX_YOUTUBE_SOURCES}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void addLink()}
          disabled={!url.trim() || items.length >= MAX_YOUTUBE_SOURCES}
        >
          Add video
        </Button>
      </div>
      {inputError ? <p className="text-xs text-destructive">{inputError}</p> : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No videos yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border bg-card px-3 py-2">
              <div className="flex items-start gap-2">
                <Youtube className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-1">
                  {item.status === "loading" ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Reading captions…
                    </p>
                  ) : null}
                  {item.status === "ready" ? (
                    <>
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.manual
                          ? "Pasted transcript"
                          : item.truncated
                            ? "Captions were cut to fit"
                            : "Captions ready"}
                        {item.channel ? ` · ${item.channel}` : ""}
                      </p>
                    </>
                  ) : null}
                  {item.status === "error" ? (
                    <div className="space-y-2">
                      <p className="text-xs text-destructive">{item.message}</p>
                      {item.message === NO_CAPTIONS_MESSAGE ? (
                        <>
                          <Label htmlFor={`skill-youtube-paste-${item.id}`}>Paste the transcript</Label>
                          <Textarea
                            id={`skill-youtube-paste-${item.id}`}
                            rows={3}
                            value={item.paste}
                            onChange={(event) => {
                              const value = event.target.value
                              setItems((current) =>
                                current.map((entry) =>
                                  entry.id === item.id && entry.status === "error"
                                    ? { ...entry, paste: value }
                                    : entry
                                )
                              )
                            }}
                            placeholder="Paste the words from the video"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => applyTranscript(item.id)}
                            disabled={!item.paste.trim()}
                          >
                            Use transcript
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label={
                    item.status === "ready" ? `Remove ${item.title}` : `Remove ${item.url}`
                  }
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
