"use client"

import * as React from "react"

import type { SettingsSectionId } from "@/lib/settings/sections"
import { ProvidersPanel } from "@/components/features/providers/providers-panel"
import { AiSettingsCard } from "@/components/features/settings/ai-settings-card"
import { BrowserAutomationCard } from "@/components/features/settings/browser-automation-card"
import { McpServersPanel } from "@/components/features/settings/mcp-servers-panel"
import { ModelsTable } from "@/components/features/settings/models-table"
import { ProjectsPanel } from "@/components/features/settings/projects-panel"
import { WorkspacesPanel } from "@/components/features/settings/workspaces-panel"

/** The content of one Settings section. */
export function SettingsSectionView({ section }: { section: SettingsSectionId }): React.ReactElement {
  switch (section) {
    case "workspaces":
      return <WorkspacesPanel />
    case "projects":
      return <ProjectsPanel />
    case "providers":
      return <ProvidersPanel />
    case "models":
      return <ModelsTable />
    case "assistant":
      return <AiSettingsCard part="assistant" />
    case "jev":
      return <AiSettingsCard part="jev" />
    case "mcp":
      return <McpServersPanel />
    case "browser":
      return <BrowserAutomationCard />
  }
}
