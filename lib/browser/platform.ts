import { DESKTOP_ENV_FLAG } from "./constants"

/**
 * True when BlackAgents is running inside the Electron desktop shell.
 * The Next server must receive BLACK_AGENTS_DESKTOP=1 from Electron
 * (production utilityProcess) or from desktop:dev.
 */
export function isDesktopRuntime(): boolean {
  return process.env[DESKTOP_ENV_FLAG] === "1"
}

/** User-facing reason when browser automation is unavailable. */
export function browserUnavailableReason(): string | null {
  if (isDesktopRuntime()) return null
  return "Browser automation requires the BlackAgents desktop app (Electron)."
}
