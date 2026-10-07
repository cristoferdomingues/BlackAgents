import { fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { sseResponse } from "@/lib/sse"
import { getRunner } from "@/lib/workflows/runner"
import { isTerminal, type WorkflowRun } from "@/lib/workflows/schema"
import { readRun } from "@/lib/workflows/store"

interface RouteContext {
  params: Promise<{ id: string }>
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
        const unsubscribe = getRunner().subscribe((run: WorkflowRun) => {
          if (run.id !== id) return
          send("run", run)
          if (isTerminal(run.status)) done()
        })
        function done(): void {
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
