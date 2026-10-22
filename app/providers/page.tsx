import { redirect } from "next/navigation"

import { settingsHref } from "@/lib/settings/sections"

export default function Page() {
  redirect(settingsHref("providers"))
}
