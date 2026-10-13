import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { DEFAULT_BROWSER_PROFILE } from "./constants"

function expandHome(p: string): string {
  if (p === "~") return os.homedir()
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2))
  return p
}

function configDir(): string {
  const override = process.env.BLACK_AGENTS_CONFIG_DIR
  return override ? expandHome(override) : path.join(os.homedir(), ".black-agents")
}

/** Absolute path for a persistent Playwright user-data directory. */
export function browserProfileDir(profileName = DEFAULT_BROWSER_PROFILE): string {
  const safe = profileName.replace(/[^a-zA-Z0-9_-]/g, "_") || DEFAULT_BROWSER_PROFILE
  return path.join(configDir(), "browser-profiles", safe)
}

export type BrowserProfilePreflight =
  | { ok: true; profileDir: string; exists: boolean }
  | { ok: false; profileDir: string; error: string }

/**
 * Ensure the profile directory exists. Does not validate cookies/SSO —
 * expired sessions fail later with a clear re-login message from the agent.
 */
export async function ensureBrowserProfile(
  profileName = DEFAULT_BROWSER_PROFILE
): Promise<BrowserProfilePreflight> {
  const profileDir = browserProfileDir(profileName)
  try {
    await fs.mkdir(profileDir, { recursive: true })
    const entries = await fs.readdir(profileDir)
    return { ok: true, profileDir, exists: entries.length > 0 }
  } catch (err) {
    return {
      ok: false,
      profileDir,
      error:
        err instanceof Error
          ? err.message
          : "Could not create the browser profile directory",
    }
  }
}

/** Message for runs when the session likely needs a human login. */
export function reLoginHint(profileDir: string): string {
  return (
    `Browser session may be expired or empty. Open Settings → Browser, ` +
    `start a headed session, and log in again. Profile: ${profileDir}`
  )
}
