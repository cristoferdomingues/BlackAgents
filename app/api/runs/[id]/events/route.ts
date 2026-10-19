import { fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { sseResponse } from "@/lib/sse"
import { getRunner } from "@/lib/workflows/runner"
import { isTerminal, type WorkflowRun } from "@/lib/workflows/schema"
import { readRun } from "@/lib/workflows/store"

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Keep-alive interval for open run streams. Override in tests via env. */
export function runEventsPingMs(): number {
  const raw = process.env.BLACK_AGENTS_SSE_PING_MS
  const n = raw ? Number(raw) : 15_000
  return Number.isFinite(n) && n > 0 ? n : 15_000
}

/** Live run snapshots (`run` events) until the run finishes. */
export async function GET(req: Request, ctx: RouteContext) {
  return handle(async () => {
    const { id } = await ctx.params
    const { currentPath } = await readConfig()
    if (!currentPath) return fail("No workspace selected", 412)
    const initial = await readRun(currentPath, id)
    if (!initial) return fail("Run not found", 404)

    return sseResponse(async (send, signal) => {
      send("run", initial)
      if (isTerminal(initial.status)) return
      await new Promise<void>((resolve) => {
        const ping = setInterval(() => {
          send("ping", { serverTime: new Date().toISOString() })
        }, runEventsPingMs())
        ping.unref?.()
        const unsubscribe = getRunner().subscribe((run: WorkflowRun) => {
          if (run.id !== id) return
          send("run", run)
          if (isTerminal(run.status)) done()
        })
        function done(): void {
          clearInterval(ping)
          unsubscribe()
          resolve()
        }
        signal.addEventListener("abort", done, { once: true })
        void readRun(currentPath, id).then((latest) => {
          if (latest && isTerminal(latest.status)) {
            send("run", latest)
            done()
          }
        })
      })
    }, req.signal)
  })
}
