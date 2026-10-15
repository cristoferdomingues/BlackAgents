import { ok, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { driftReport } from "@/lib/artifacts/drift"

/** Read-only report: source copies vs. each IDE folder, plus IDE-only artifacts. */
export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) {
      return ok({ targets: [], targetsSaved: false, sourceCount: 0, ideOnly: [], platforms: [] })
    }
    return ok(await driftReport(config.currentPath))
  })
}
