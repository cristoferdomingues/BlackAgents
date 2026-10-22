import { describe, expect, it } from "vitest"

import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSection,
  sectionForLegacyTab,
  SETTINGS_GROUPS,
  SETTINGS_SECTION_IDS,
  SETTINGS_SECTIONS,
  settingsHref,
  settingsSection,
} from "@/lib/settings/sections"

describe("settings sections", () => {
  it("lists every section once, in a known group, with a one-line intro", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([...SETTINGS_SECTION_IDS])
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS_GROUPS).toContain(section.group)
      expect(section.intro.length).toBeGreaterThan(20)
    }
  })

  it("builds one link per section", () => {
    expect(settingsHref("models")).toBe("/settings/models")
    expect(settingsSection("providers").label).toBe("AI providers")
  })

  it("accepts only known section ids", () => {
    expect(isSettingsSection("mcp")).toBe(true)
    expect(isSettingsSection("ai")).toBe(false)
    expect(isSettingsSection(undefined)).toBe(false)
    expect(isSettingsSection(["mcp"])).toBe(false)
  })

  it("sends old ?tab= links to the new sections", () => {
    expect(sectionForLegacyTab("create")).toBe("workspaces")
    expect(sectionForLegacyTab("open")).toBe("workspaces")
    expect(sectionForLegacyTab("ai")).toBe("models")
    expect(sectionForLegacyTab("mcp")).toBe("mcp")
    expect(sectionForLegacyTab("jev")).toBe("jev")
  })

  it("falls back to the default for missing or unknown tabs", () => {
    expect(sectionForLegacyTab(undefined)).toBe(DEFAULT_SETTINGS_SECTION)
    expect(sectionForLegacyTab(["ai", "mcp"])).toBe(DEFAULT_SETTINGS_SECTION)
    expect(sectionForLegacyTab("nope")).toBe(DEFAULT_SETTINGS_SECTION)
  })
})
