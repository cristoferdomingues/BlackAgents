/** Server-Sent Events helpers for route handlers. */

export type SseSend = (event: string, data: unknown) => void

export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Build a streaming response. `run` gets a `send` function and an abort
 * signal that fires when the client disconnects. The stream closes when `run`
 * settles; a thrown error becomes a final `error` event.
 */
export function sseResponse(
  run: (send: SseSend, signal: AbortSignal) => Promise<void>,
  clientSignal?: AbortSignal
): Response {
  const encoder = new TextEncoder()
  const controller = new AbortController()
  clientSignal?.addEventListener("abort", () => controller.abort(), { once: true })

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let open = true
      const send: SseSend = (event, data) => {
        if (!open) return
        try {
          streamController.enqueue(encoder.encode(encodeSse(event, data)))
        } catch {
          open = false
        }
      }
      try {
        await run(send, controller.signal)
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Unexpected error",
          status: 500,
        })
      } finally {
        open = false
        try {
          streamController.close()
        } catch {
          // already closed by a disconnect
        }
      }
    },
    cancel() {
      controller.abort()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
