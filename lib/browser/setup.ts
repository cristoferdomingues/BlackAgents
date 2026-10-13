import {
  readWorkspaceMcpConfig,
  saveWorkspaceMcpServer,
} from "@/lib/mcp/config"
import { setMcpServerTrust } from "@/lib/mcp/policy"
import type { McpServerConfig } from "@/lib/mcp/types"

import { BROWSER_MCP_SERVER, DEFAULT_BROWSER_PROFILE } from "./constants"
import { browserUnavailableReason, isDesktopRuntime } from "./platform"
import { browserProfileDir, ensureBrowserProfile } from "./profile"

export interface BrowserSetupResult {
  configured: boolean
  server: string
  profileDir: string
  profileExists: boolean
  trust: "risky"
  reason?: string
}

/** Build the stdio MCP config for @playwright/mcp with a persistent profile. */
export function browserMcpServerConfig(profileDir: string): McpServerConfig {
  return {
    command: "npx",
    args: [
      "-y",
      "@playwright/mcp@latest",
      "--browser",
      "chromium",
      "--user-data-dir",
      profileDir,
    ],
    env: {},
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
  profileName = DEFAULT_BROWSER_PROFILE
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

  await saveWorkspaceMcpServer(
    workspaceRoot,
    BROWSER_MCP_SERVER,
    browserMcpServerConfig(profile.profileDir)
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
  profileDir: string
  profileExists: boolean
  reason: string | null
}> {
  const desktop = isDesktopRuntime()
  const reason = browserUnavailableReason()
  const profileDir = browserProfileDir()
  const profile = await ensureBrowserProfile()
  const config = await readWorkspaceMcpConfig(workspaceRoot)
  const server = config.mcpServers[BROWSER_MCP_SERVER]
  return {
    desktop,
    configured: Boolean(server),
    disabled: Boolean(server?.disabled),
    profileDir,
    profileExists: profile.ok && profile.exists,
    reason,
  }
}
