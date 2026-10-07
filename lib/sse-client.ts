import { ApiError, type ApiEnvelope } from "./api"

/** One parsed Server-Sent Event. */
export interface SseEvent {
  event: string
  data: unknown
}

/** Parse complete SSE frames from a buffer; returns the leftover text. */
export function parseSseFrames(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const frames = buffer.split(/\r?\n\r?\n/)
  const rest = frames.pop() ?? ""
  for (const frame of frames) {
    let event = "message"
    const dataLines: string[] = []
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) continue
    try {
      events.push({ event, data: JSON.parse(dataLines.join("\n")) as unknown })
    } catch {
      events.push({ event, data: dataLines.join("\n") })
    }
  }
  return { events, rest }
}

/**
 * POST JSON and read an SSE reply. A JSON reply (validation or credential
 * errors before the stream starts) is raised as an `ApiError`.
 */
export async function streamPost(
  url: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  })
  const type = res.headers.get("content-type") ?? ""
  if (!type.includes("text/event-stream")) {
    const envelope = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null
    throw new ApiError(envelope?.error ?? `Request failed (${res.status})`)
  }
  await readSse(res, onEvent)
}

/** GET an SSE stream (live run updates). */
export async function streamGet(
  url: string,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, { headers: { Accept: "text/event-stream" }, signal })
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`)
  await readSse(res, onEvent)
}

async function readSse(res: Response, onEvent: (event: SseEvent) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseFrames(buffer)
    buffer = parsed.rest
    for (const event of parsed.events) onEvent(event)
  }
  const tail = parseSseFrames(`${buffer}\n\n`)
  for (const event of tail.events) onEvent(event)
}
