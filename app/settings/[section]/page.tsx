import { notFound } from "next/navigation"

import { isSettingsSection, SETTINGS_SECTION_IDS } from "@/lib/settings/sections"
import { SettingsSectionView } from "@/components/features/settings/settings-section"

export function generateStaticParams(): Array<{ section: string }> {
  return SETTINGS_SECTION_IDS.map((section) => ({ section }))
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  if (!isSettingsSection(section)) notFound()
  return <SettingsSectionView section={section} />
}
