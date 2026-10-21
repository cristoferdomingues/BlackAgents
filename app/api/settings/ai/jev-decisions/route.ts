import { ok, handle } from "@/lib/api-response"
import { clearDecisionLog, DECISION_LOG_MAX, readDecisionLog } from "@/lib/decision/log"

async function snapshot() {
  const entries = await readDecisionLog()
  return { entries: entries.reverse(), max: DECISION_LOG_MAX }
}

/** Recent Jev decisions, newest first. Holds labels and scores only, never chat text. */
export async function GET() {
  return handle(async () => ok(await snapshot()))
}

/** Empty the decision log. Cutoffs in settings stay as they are. */
export async function DELETE() {
  return handle(async () => {
    await clearDecisionLog()
    return ok(await snapshot())
  })
}
