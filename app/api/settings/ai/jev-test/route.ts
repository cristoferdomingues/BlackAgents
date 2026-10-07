import { ok, fail, handle } from "@/lib/api-response"
import { probeDecisionEngine } from "@/lib/decision/probe"

/** One cheap Jev call to prove the saved setup works. */
export async function POST() {
  return handle(async () => {
    const result = await probeDecisionEngine()
    if (result.ok) return ok(result)
    return fail(result.message, result.code === "JEV_ERROR" ? 502 : 412)
  })
}
