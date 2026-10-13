import { ok, fail, handle } from "@/lib/api-response"
import {
  fetchYouTubeSource,
  youtubeSourceRequestSchema,
  YouTubeSourceError,
} from "@/lib/sources/youtube"

/**
 * Read a YouTube video's title and captions. The link is checked here; the
 * server only talks to youtube.com.
 */
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const json: unknown = await req.json().catch(() => null)
    if (!json || typeof json !== "object") return fail("Invalid request body")
    const parsed = youtubeSourceRequestSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body")
    }
    try {
      const source = await fetchYouTubeSource(parsed.data.url, {
        language: parsed.data.language,
      })
      return ok(source)
    } catch (err) {
      if (err instanceof YouTubeSourceError) return fail(err.message, err.status)
      throw err
    }
  })
}
