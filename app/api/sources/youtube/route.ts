import { ok, fail, handle } from "@/lib/api-response"
import { isOpenRouterBaseUrl } from "@/lib/decision/client"
import {
  CredentialStateError,
  getVerifiedCredentials,
  markInvalidOnAuthFailure,
} from "@/lib/llm/credentials"
import { getProvider } from "@/lib/llm/registry"
import { resolveTaskModel } from "@/lib/llm/task-models"
import { ProviderError } from "@/lib/llm/types"
import {
  VIDEO_MODEL_MISSING,
  WATCH_NEEDS_CUSTOM,
  watchLengthError,
  watchYouTubeVideo,
} from "@/lib/llm/watch-video"
import { readAiSettings } from "@/lib/settings"
import {
  fetchYouTubeSource,
  NO_CAPTIONS_MESSAGE,
  youtubeSourceRequestSchema,
  YouTubeSourceError,
  type YouTubeSource,
} from "@/lib/sources/youtube"

type WatchResult = { notes: string } | { error: string; status: number }

/**
 * Read a YouTube video's title and captions. The link is checked here; the
 * server only talks to youtube.com. With `watch`, the Video task model on the
 * Custom provider also writes notes on what the video shows. When watching
 * fails, the captions still come back with a `watchError`.
 */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const json: unknown = await req.json().catch(() => null)
    if (!json || typeof json !== "object") return fail("Invalid request body")
    const parsed = youtubeSourceRequestSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    }
    const { url, language, watch } = parsed.data
    let source: YouTubeSource
    try {
      source = await fetchYouTubeSource(url, { language, allowNoCaptions: watch === true })
    } catch (err) {
      if (err instanceof YouTubeSourceError) return fail(err.message, err.status)
      throw err
    }
    if (!watch) return ok(source)

    const result = await watchSource(source, language)
    if ("notes" in result) return ok({ ...source, visualNotes: result.notes })
    if (!source.transcript) {
      return fail(`${result.error.replace(/\.$/, "")}. ${NO_CAPTIONS_MESSAGE}`, result.status)
    }
    return ok({ ...source, watchError: result.error })
  })
}

async function watchSource(source: YouTubeSource, language?: string): Promise<WatchResult> {
  const tooLong = watchLengthError(source.durationSeconds)
  if (tooLong) return { error: tooLong, status: 413 }

  const provider = getProvider("custom")
  if (!provider) return { error: WATCH_NEEDS_CUSTOM, status: 412 }
  let verified: Awaited<ReturnType<typeof getVerifiedCredentials>>
  try {
    verified = await getVerifiedCredentials(provider)
  } catch (error) {
    if (error instanceof CredentialStateError) return { error: WATCH_NEEDS_CUSTOM, status: error.status }
    throw error
  }

  const settings = await readAiSettings()
  const model = resolveTaskModel(
    "video",
    settings.models.video,
    isOpenRouterBaseUrl(verified.credentials.baseUrl)
  )
  if (!model) return { error: VIDEO_MODEL_MISSING, status: 412 }

  try {
    const notes = await watchYouTubeVideo(
      { videoId: source.videoId, model, language },
      verified.credentials
    )
    return { notes }
  } catch (err) {
    if (err instanceof ProviderError) {
      await markInvalidOnAuthFailure(provider, err, verified.secret)
      return { error: err.message, status: err.status }
    }
    throw err
  }
}
