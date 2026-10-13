import { ok, fail, handle } from "@/lib/api-response"
import {
  browserFlowInputSchema,
  listBrowserFlows,
  saveBrowserFlow,
} from "@/lib/browser"
import { readConfig } from "@/lib/config"

export async function GET() {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return fail("No active workspace selected", 400)
    const flows = await listBrowserFlows(config.currentPath)
    return ok({ flows })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const config = await readConfig()
    if (!config.currentPath) return fail("No active workspace selected", 400)

    const json = await req.json().catch(() => null)
    const parsed = browserFlowInputSchema.safeParse(json)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid flow", 400)
    }

    const flow = await saveBrowserFlow(config.currentPath, parsed.data)
    return ok({ flow })
  })
}
