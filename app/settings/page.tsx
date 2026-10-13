import { SettingsPage } from "@/components/features/settings/settings-page"

const SETTINGS_TABS = ["create", "open", "mcp", "browser", "ai"] as const
type SettingsTab = (typeof SETTINGS_TABS)[number]

function isSettingsTab(value: string | string[] | undefined): value is SettingsTab {
  return typeof value === "string" && SETTINGS_TABS.some((tab) => tab === value)
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const requested = (await searchParams).tab
  return <SettingsPage initialTab={isSettingsTab(requested) ? requested : "create"} />
}
