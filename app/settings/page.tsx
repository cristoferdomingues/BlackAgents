import { redirect } from "next/navigation"

import { sectionForLegacyTab, settingsHref } from "@/lib/settings/sections"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  redirect(settingsHref(sectionForLegacyTab((await searchParams).tab)))
}
