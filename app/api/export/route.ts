import { ok, fail, handle } from "@/lib/api-response"
import { readConfig } from "@/lib/config"
import { scanWorkspace } from "@/lib/artifacts/parser"
import { PLATFORM_LAYOUTS } from "@/lib/artifacts/layout"
import { buildExportManifest } from "@/lib/export/adapter"
import type { Platform } from "@/lib/artifacts/types"

/**
 * Returns the file manifest for re-emitting the current workspace's artifacts
 * to a target platform. The first building block of multi-platform export;
 * a future phase adds write-to-disk and .zip download on top of this.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url)
    const platform = (url.searchParams.get("platform") ?? "cursor") as Platform
    if (!(platform in PLATFORM_LAYOUTS)) {
      return fail(`Unknown platform: ${platform}`)
    }

    const config = await readConfig()
    if (!config.currentPath) return ok({ platform, files: [] })

    const artifacts = await scanWorkspace(config.currentPath)
    return ok({ platform, files: buildExportManifest(artifacts, platform) })
  })
}
