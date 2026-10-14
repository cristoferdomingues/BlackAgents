import { closePersistentMcpServer } from "@/lib/mcp/client"
import {
  readWorkspaceMcpConfig,
  saveWorkspaceMcpServer,
} from "@/lib/mcp/config"
import { setMcpServerTrust } from "@/lib/mcp/policy"
import { prepareStdioLaunch } from "@/lib/mcp/stdio-command"
import type { McpServerConfig } from "@/lib/mcp/types"
import { readAiSettings, updateAiSettings } from "@/lib/settings"

import { BROWSER_MCP_SERVER, DEFAULT_BROWSER_PROFILE } from "./constants"
import { browserUnavailableReason, isDesktopRuntime } from "./platform"
import { browserProfileDir, ensureBrowserProfile } from "./profile"

export interface BrowserMcpLaunchOptions {
  /** Chromium with no window. Default is a visible window. */
  headless?: boolean
}

export interface BrowserSetupResult {
  configured: boolean
  server: string
  profileDir: string
  profileExists: boolean
  trust: "risky"
  reason?: string
}

/** Build the stdio MCP config for @playwright/mcp with a persistent profile. */
export function browserMcpServerConfig(
  profileDir: string,
  options: BrowserMcpLaunchOptions = {}
): McpServerConfig {
  const headless = options.headless === true
  // Resolve `npx` against an enriched PATH so GUI-launched Node finds Homebrew.
  const launch = prepareStdioLaunch("npx", {})
  const args = [
    "-y",
    "@playwright/mcp@latest",
    "--browser",
    "chromium",
    "--user-data-dir",
    profileDir,
  ]
  if (headless) args.push("--headless")
  return {
    command: launch.command,
    args,
    // Explicit env so a parent CI/headless flag cannot hide the window.
    env: { PLAYWRIGHT_MCP_HEADLESS: headless ? "true" : "false" },
    headers: {},
    disabled: false,
  }
}

/**
 * Register the Playwright browser MCP server (risky trust) and ensure the
 * persistent profile directory exists. No-op with a reason outside Electron.
 */
export async function ensureBrowserMcpSetup(
  workspaceRoot: string,
  profileName = DEFAULT_BROWSER_PROFILE,
  options: BrowserMcpLaunchOptions = {}
): Promise<BrowserSetupResult> {
  const unavailable = browserUnavailableReason()
  const profile = await ensureBrowserProfile(profileName)
  if (!profile.ok) {
    return {
      configured: false,
      server: BROWSER_MCP_SERVER,
      profileDir: profile.profileDir,
      profileExists: false,
      trust: "risky",
      reason: profile.error,
    }
  }

  if (unavailable) {
    return {
      configured: false,
      server: BROWSER_MCP_SERVER,
      profileDir: profile.profileDir,
      profileExists: profile.exists,
      trust: "risky",
      reason: unavailable,
    }
  }

  const settings = await readAiSettings()
  const headless = options.headless ?? settings.browser.headless
  if (headless !== settings.browser.headless) {
    await updateAiSettings({ browser: { headless } })
  }

  // Drop the running browser so the next launch picks up headless vs window.
  await closePersistentMcpServer(workspaceRoot, BROWSER_MCP_SERVER)
  await saveWorkspaceMcpServer(
    workspaceRoot,
    BROWSER_MCP_SERVER,
    browserMcpServerConfig(profile.profileDir, { headless })
  )
  await setMcpServerTrust(workspaceRoot, BROWSER_MCP_SERVER, "risky")

  return {
    configured: true,
    server: BROWSER_MCP_SERVER,
    profileDir: profile.profileDir,
    profileExists: profile.exists,
    trust: "risky",
  }
}

export async function browserMcpStatus(workspaceRoot: string): Promise<{
  desktop: boolean
  configured: boolean
  disabled: boolean
  headless: boolean
  profileDir: string
  profileExists: boolean
  reason: string | null
}> {
  const desktop = isDesktopRuntime()
  const reason = browserUnavailableReason()
  const profileDir = browserProfileDir()
  const profile = await ensureBrowserProfile()
  const [config, settings] = await Promise.all([
    readWorkspaceMcpConfig(workspaceRoot),
    readAiSettings(),
  ])
  const server = config.mcpServers[BROWSER_MCP_SERVER]
  return {
    desktop,
    configured: Boolean(server),
    disabled: Boolean(server?.disabled),
    headless: settings.browser.headless,
    profileDir,
    profileExists: profile.ok && profile.exists,
    reason,
  }
}
