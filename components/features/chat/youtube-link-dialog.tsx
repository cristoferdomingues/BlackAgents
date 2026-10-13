"use client"

import * as React from "react"
import { Loader2, Youtube } from "lucide-react"
import { toast } from "sonner"

import { ApiError, apiFetch } from "@/lib/api"
import {
  AttachmentError,
  manualYouTubeAttachment,
  youtubeAttachmentSchema,
  type YouTubeAttachment,
} from "@/lib/chat/attachments"
import { NO_CAPTIONS_MESSAGE, parseYouTubeUrl, type YouTubeSource } from "@/lib/sources/youtube"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function YouTubeLinkButton({
  disabled,
  onAdd,
}: {
  disabled?: boolean
  onAdd: (attachment: YouTubeAttachment) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [paste, setPaste] = React.useState("")
  const [videoId, setVideoId] = React.useState<string | null>(null)

  function reset(): void {
    setUrl("")
    setError(null)
    setLoading(false)
    setPaste("")
    setVideoId(null)
  }

  async function addLink(): Promise<void> {
    const submitted = url.trim()
    if (!submitted) {
      setError("Paste a YouTube link")
      return
    }
    setLoading(true)
    setError(null)
    setVideoId(null)
    try {
      const source = await apiFetch<YouTubeSource>("/api/sources/youtube", {
        method: "POST",
        body: JSON.stringify({
          url: submitted,
          language: typeof navigator === "undefined" ? undefined : navigator.language,
        }),
      })
      const parsed = youtubeAttachmentSchema.safeParse({
        kind: "youtube",
        videoId: source.videoId,
        url: source.url,
        title: source.title,
        channel: source.channel,
        transcript: source.transcript,
      })
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Could not use this video")
        return
      }
      onAdd(parsed.data)
      if (source.truncated) toast("The transcript was cut to fit")
      setOpen(false)
      reset()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not read this video"
      setError(message)
      if (message === NO_CAPTIONS_MESSAGE) setVideoId(parseYouTubeUrl(submitted))
    } finally {
      setLoading(false)
    }
  }

  function applyTranscript(): void {
    if (!videoId) return
    try {
      onAdd(manualYouTubeAttachment(videoId, paste))
      setOpen(false)
      reset()
    } catch (err) {
      setError(err instanceof AttachmentError ? err.message : "Could not use that transcript")
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={disabled}
            aria-label="Add a YouTube video"
          >
            <Youtube className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add a YouTube video</TooltipContent>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a YouTube video</DialogTitle>
            <DialogDescription>
              The assistant reads the captions. It does not watch the video.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (videoId) applyTranscript()
              else void addLink()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="chat-youtube-url">YouTube link</Label>
              <Input
                id="chat-youtube-url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value)
                  setError(null)
                  setVideoId(null)
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                spellCheck={false}
                disabled={loading}
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {videoId ? (
              <div className="space-y-2">
                <Label htmlFor="chat-youtube-paste">Paste the transcript</Label>
                <Textarea
                  id="chat-youtube-paste"
                  rows={4}
                  value={paste}
                  onChange={(event) => setPaste(event.target.value)}
                  placeholder="Paste the words from the video"
                />
              </div>
            ) : null}
            <DialogFooter>
              {videoId ? (
                <Button type="submit" disabled={!paste.trim()}>
                  Use transcript
                </Button>
              ) : (
                <Button type="submit" disabled={loading || !url.trim()}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add video
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
