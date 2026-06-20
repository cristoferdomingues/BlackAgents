import { ok, handle } from "@/lib/api-response"
import { checkDirectory, normalizeWorkspaceInput } from "@/lib/fs-service"
import { detectPlatforms } from "@/lib/artifacts/parser"
import { PLATFORM_LAYOUTS } from "@/lib/artifacts/layout"

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url)
    const raw = url.searchParams.get("path") ?? ""
    if (!raw.trim()) {
      return ok({ exists: false, isDirectory: false, platforms: [] })
    }
    const abs = normalizeWorkspaceInput(raw)
    const check = await checkDirectory(abs)
    const platforms = check.isDirectory ? await detectPlatforms(abs) : []
    return ok({
      ...check,
      path: abs,
      platforms: platforms.map((p) => ({
        id: p,
        label: PLATFORM_LAYOUTS[p].label,
      })),
    })
  })
}
