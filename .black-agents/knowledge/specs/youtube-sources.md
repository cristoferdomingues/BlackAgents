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
> A YouTube link becomes a title plus a caption transcript. The assistant and **Skills → New** use that text as reference, the same way they use an attached file. The model never opens the video URL.

## Why captions

OpenAI, Anthropic, and the custom provider cannot watch a link. `lib/sources/youtube.ts` asks YouTube for the caption track, then downloads that track. The pasted link is only parsed for an 11-character video id. The server fetches URLs it builds on `https://www.youtube.com` (oEmbed, the player API, then the caption URL). A caption URL on another host, or a redirect off YouTube, is rejected (**502**).

Accepted links: `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`, `m.youtube.com`, and the same links without `https://`.

## `POST /api/sources/youtube`

Body: `{ url, language? }`. `language` is a BCP-47 hint (the browser sends `navigator.language`).

| Status | When |
|--------|------|
| 200 | `{ videoId, url, title, channel, language, transcript, truncated }` |
| 400 | The link is not a YouTube video |
| 404 | No captions, video not found, or the video needs a sign-in |
| 502 | YouTube failed, timed out (12 s), or returned an unexpected caption link |

Manual captions beat auto-generated (`kind: "asr"`). The requested language wins, then English. The transcript is cut at **200 KB** (`MAX_TEXT_BYTES` in `lib/chat/attachments.ts`) and ends with `[Transcript cut: the video is longer than the limit.]` when `truncated` is true.

> [!warning] Unofficial captions
> The player call uses YouTube's Android client because the web player often hides caption URLs. If YouTube changes that response, only `lib/sources/youtube.ts` needs a new reader. There is no new npm package.

When a video has no captions, the UI says so and the user can paste the transcript. `manualYouTubeAttachment()` stores it as a `youtube` attachment titled "YouTube video".

## Chat

The paperclip stays for files. A YouTube button (`components/features/chat/youtube-link-dialog.tsx`) adds a fourth attachment kind:

```ts
{
  kind: "youtube"
  videoId: string
  url: string
  title: string
  channel: string
  transcript: string
}
```

`renderTextAttachments` quotes it under `## YouTube videos` and tells the model the transcript is data, not instructions. It is **not** a native image or PDF part. History keeps the title, kind, size, and url — not the transcript (`lib/chat/conversation-history.ts`). At most 5 attachments, 20 MB together, same as files.

## Skills → New

`YouTubeSourcesField` (`components/features/editor/youtube-sources.tsx`) is on the skill **create** page only. Up to **5** videos. Each card is loading, ready, or error (with a paste box when captions are missing).

**Draft with assistant** can run with a valid name and at least one ready video, even when the description is empty. The route then asks the model to write the description. `POST /api/artifacts/draft-body` accepts optional `sources: { videoId, url, title, channel, transcript }[]`. The transcripts are quoted in the user turn (`renderYouTubeSourcesForPrompt`). After the draft parses, `ensureSourcesSection` appends a `## Sources` list of markdown links when the model forgot one. The response also returns `description`, and the editor fills the description field only when it was empty.

The graph still comes from the saved body. A YouTube link is not an artifact cross-reference.

## Related

- [Assisted Artifact Drafting](./assisted-artifact-drafting.md) — the draft button this extends
- [Skills](../artifacts/skills.md) — where the source list appears
- [LLM Integration](../architecture/llm-integration.md) — how a `youtube` attachment reaches the model
- [API Reference](../api/api-reference.md) — `/api/sources/youtube` and `/api/artifacts/draft-body`
- [UI Overview](../ui/ui-overview.md) — the chat button and the skill field
