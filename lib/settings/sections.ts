/** The Settings side menu: one short page per section (safe for the browser). */

export const SETTINGS_SECTION_IDS = [
  "workspaces",
  "projects",
  "providers",
  "models",
  "assistant",
  "jev",
  "mcp",
  "browser",
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export const SETTINGS_GROUPS = ["Workspace", "AI", "Tools"] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

export interface SettingsSection {
  id: SettingsSectionId
  group: SettingsGroup
  label: string
  /** One line under the section title: what it holds and why it matters. */
  intro: string
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "workspaces",
    group: "Workspace",
    label: "Workspaces",
    intro: "The folders this app knows. The active one is the folder it reads and writes.",
  },
  {
    id: "projects",
    group: "Workspace",
    label: "Projects",
    intro: "Smaller areas inside the active workspace, each with its own artifacts.",
  },
  {
    id: "providers",
    group: "AI",
    label: "AI providers",
    intro: "Add your own API keys. Keys stay on this computer, and the local server calls the provider.",
  },
  {
    id: "models",
    group: "AI",
    label: "Models",
    intro: "Pick a model for each job, like voice, meetings, or code. The Assistant header model still answers chat.",
  },
  {
    id: "assistant",
    group: "AI",
    label: "Assistant",
    intro: "How many tool rounds one reply may use, and whether file writes ask you first.",
  },
  {
    id: "jev",
    group: "AI",
    label: "Jev",
    intro: "An optional helper that picks what goes into a chat and what the Brain learns.",
  },
  {
    id: "mcp",
    group: "Tools",
    label: "MCP servers",
    intro: "MCP (Model Context Protocol) lets an agent call tools on another program. Servers here belong to the active folder.",
  },
  {
    id: "browser",
    group: "Tools",
    label: "Browser",
    intro: "Record steps in a browser, then run those steps again later.",
  },
]

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "workspaces"

export function isSettingsSection(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && SETTINGS_SECTION_IDS.some((id) => id === value)
}

export function settingsHref(id: SettingsSectionId): string {
  return `/settings/${id}`
}

export function settingsSection(id: SettingsSectionId): SettingsSection {
  const found = SETTINGS_SECTIONS.find((section) => section.id === id)
  if (!found) throw new Error(`Unknown settings section: ${id}`)
  return found
}

/** Old `/settings?tab=` links keep working. */
const LEGACY_TABS: Record<string, SettingsSectionId> = {
  create: "workspaces",
  open: "workspaces",
  mcp: "mcp",
  browser: "browser",
  ai: "models",
}

export function sectionForLegacyTab(tab: string | string[] | undefined): SettingsSectionId {
  if (typeof tab !== "string") return DEFAULT_SETTINGS_SECTION
  if (isSettingsSection(tab)) return tab
  return LEGACY_TABS[tab] ?? DEFAULT_SETTINGS_SECTION
}
