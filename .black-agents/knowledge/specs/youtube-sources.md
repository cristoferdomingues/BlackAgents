---
type: Spec
title: YouTube Sources
description: captions as a reference for a new skill and for chat
tags:
  - blackagents
  - spec
  - llm
  - skills
  - chat
sources:
  - resource: >-
      file:///Users/cristoferdomingues/Documents/Obsidian%20Vault/BlackAgents/07%20-%20Specs/YouTube%20Sources.md
    title: YouTube Sources
    last_modified: '2026-10-13T00:00:00Z'
generated:
  by: 'process:obsidian-to-okf'
  at: '2026-10-16T16:05:00Z'
status: draft
verified:
  - by: 'human:local'
    at: '2026-10-16T16:15:43Z'
---

# YouTube Sources

> [!abstract] One-liner
> A YouTube link becomes a title plus a caption transcript. The assistant and **Skills → New** use that text as reference, the same way they use an attached file. The chat model never opens the video URL. With **Watch the video** on, a separate Video task model also watches it and writes notes on what it shows.

## Why captions

OpenAI, Anthropic, and the custom provider cannot watch a link. `lib/sources/youtube.ts` asks YouTube for the caption track, then downloads that track. The pasted link is only parsed for an 11-character video id. The server fetches URLs it builds on `https://www.youtube.com` (oEmbed, the player API, then the caption URL). A caption URL on another host, or a redirect off YouTube, is rejected (**502**).

Accepted links: `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`, `m.youtube.com`, and the same links without `https://`.

## `POST /api/sources/youtube`

Body: `{ url, language?, watch? }`. `language` is a BCP-47 hint (the browser sends `navigator.language`). `watch: true` turns on [Watch video](#watch-video).

| Status | When |
|--------|------|
| 200 | `{ videoId, url, title, channel, language, transcript, truncated, durationSeconds, visualNotes?, watchError? }` |
| 400 | The link is not a YouTube video |
| 404 | No captions, video not found, or the video needs a sign-in |
| 502 | YouTube failed, timed out (12 s), or returned an unexpected caption link |

Manual captions beat auto-generated (`kind: "asr"`). The requested language wins, then English. The transcript is cut at **200 KB** (`MAX_TEXT_BYTES` in `lib/chat/attachments.ts`) and ends with `[Transcript cut: the video is longer than the limit.]` when `truncated` is true.

> [!warning] Unofficial captions
> The player call uses YouTube's Android client because the web player often hides caption URLs. If YouTube changes that response, only `lib/sources/youtube.ts` needs a new reader. There is no new npm package.

When a video has no captions, the UI says so and the user can paste the transcript. `manualYouTubeAttachment()` stores it as a `youtube` attachment titled "YouTube video".

## Watch video

A **Watch the video** switch sits in the chat dialog and in the skill sources field. The choice is kept in `localStorage` (`blackagents.youtube.watch`). It is off by default.

With `watch: true` the route also:

1. Checks the length from the player API (`videoDetails.lengthSeconds`). Videos over **30 min** (`MAX_WATCH_SECONDS`) are not watched.
2. Uses **AI Providers → Custom** with a verified key. Then the model from **Settings → AI → Models by task → Video** (`settings.models.video`), else `google/gemini-2.5-flash` when the base URL is OpenRouter.
3. Calls `watchYouTubeVideo` (`lib/llm/watch-video.ts`). It sends a `video_url` part with `https://www.youtube.com/watch?v=<id>`, rebuilt from the video id. On OpenRouter, only Gemini on Google AI Studio takes YouTube links.
4. Returns the answer as `visualNotes`: timed markdown bullets, cut at **50 KB** (`MAX_VISUAL_NOTES_BYTES`). Timeout: 180 s.

Watching never blocks the captions. When it fails (no Custom provider, no model, too long, upstream error), the 200 response keeps the captions and adds `watchError`. The UI shows "Captions only: …". A 401 marks the Custom key invalid. When the video has **no captions** and watching fails, the route fails with `"<reason>. This video has no captions. Paste the transcript instead."` so the paste box still shows (`isNoCaptionsMessage`).

A watched video with no captions is valid: `transcript` may be empty when `visualNotes` is set. `attachmentsSchema` and `youtubeDraftSourceSchema` reject a video with neither ("A video needs a transcript or video notes").

The notes are data. The prompt says so, and says a video model wrote them.

## Chat

The paperclip stays for files. A YouTube button (`components/features/chat/youtube-link-dialog.tsx`) adds a fourth attachment kind:

```ts
{
  kind: "youtube"
  videoId: string
  url: string
  title: string
  channel: string
  transcript: string      // may be "" when visualNotes is set
  visualNotes?: string    // from Watch video
}
```

`renderTextAttachments` quotes it under `## YouTube videos` and tells the model the transcript and notes are data, not instructions. It is **not** a native image or PDF part. History keeps the title, kind, size, and url — not the transcript (`lib/chat/conversation-history.ts`). At most 5 attachments, 20 MB together, same as files.

## Skills → New

`YouTubeSourcesField` (`components/features/editor/youtube-sources.tsx`) is on the skill **create** page only. Up to **5** videos. Each card is loading, ready, or error (with a paste box when captions are missing).

**Draft with assistant** can run with a valid name and at least one ready video, even when the description is empty. The route then asks the model to write the description. `POST /api/artifacts/draft-body` accepts optional `sources: { videoId, url, title, channel, transcript, visualNotes? }[]`. The transcripts are quoted in the user turn (`renderYouTubeSourcesForPrompt`). After the draft parses, `ensureSourcesSection` appends a `## Sources` list of markdown links when the model forgot one. The response also returns `description`, and the editor fills the description field only when it was empty.

The graph still comes from the saved body. A YouTube link is not an artifact cross-reference.

## Related

- [Assisted Artifact Drafting](./assisted-artifact-drafting.md) — the draft button this extends
- [Skills](../artifacts/skills.md) — where the source list appears
- [LLM Integration](../architecture/llm-integration.md) — how a `youtube` attachment reaches the model
- [API Reference](../api/api-reference.md) — `/api/sources/youtube` and `/api/artifacts/draft-body`
- [UI Overview](../ui/ui-overview.md) — the chat button and the skill field
