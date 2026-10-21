import { ok, handle } from "@/lib/api-response"

/**
 * Tells the page whether it is running inside the desktop app, and on which
 * system. The microphone works everywhere. Computer sound is only captured
 * on Windows.
 */
export async function GET() {
  return handle(async () => {
    const platform = process.platform
    return ok({
      desktop: process.env.BLACK_AGENTS_DESKTOP === "1",
      platform: platform === "win32" || platform === "darwin" || platform === "linux" ? platform : "other",
    })
  })
}
