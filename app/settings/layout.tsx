import { SettingsShell } from "@/components/features/settings/settings-shell"

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>
}
