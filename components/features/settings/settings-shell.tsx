"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Boxes, Brain, FolderOpen, Globe, HelpCircle, KeyRound, Plug, SlidersHorizontal, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  HOW_IT_WORKS_STEPS,
  HOW_IT_WORKS_TITLE,
  SETTINGS_INTRO,
  SETTINGS_INTRO_STORAGE_KEY,
} from "@/lib/settings/explain"
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSection,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  settingsHref,
  settingsSection,
  type SettingsSectionId,
} from "@/lib/settings/sections"
import { Button } from "@/components/ui/button"

const SECTION_ICONS: Record<SettingsSectionId, React.ComponentType<{ className?: string }>> = {
  workspaces: FolderOpen,
  projects: Boxes,
  providers: KeyRound,
  models: SlidersHorizontal,
  assistant: Sparkles,
  jev: Brain,
  mcp: Plug,
  browser: Globe,
}

function subscribeIntro(): () => void {
  return () => undefined
}

function readIntroDismissed(): boolean {
  return window.localStorage.getItem(SETTINGS_INTRO_STORAGE_KEY) === "1"
}

function introDismissedOnServer(): boolean {
  return true
}

function activeSection(pathname: string): SettingsSectionId {
  const segment = pathname.split("/")[2]
  return isSettingsSection(segment) ? segment : DEFAULT_SETTINGS_SECTION
}

/** Settings frame: a side menu of short sections, and the open section on the right. */
export function SettingsShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const active = activeSection(usePathname())
  const section = settingsSection(active)
  const introDismissed = React.useSyncExternalStore(subscribeIntro, readIntroDismissed, introDismissedOnServer)
  const [introOverride, setIntroOverride] = React.useState<boolean | null>(null)
  const introOpen = introOverride ?? !introDismissed

  function toggleIntro(): void {
    const next = !introOpen
    setIntroOverride(next)
    if (!next) window.localStorage.setItem(SETTINGS_INTRO_STORAGE_KEY, "1")
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">{SETTINGS_INTRO}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={toggleIntro} aria-expanded={introOpen}>
          <HelpCircle className="h-4 w-4" />
          How it works
        </Button>
      </div>

      {introOpen ? <HowItWorks onClose={toggleIntro} /> : null}

      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="md:sticky md:top-6 md:self-start">
          <div className="flex gap-4 overflow-x-auto pb-2 md:block md:space-y-4 md:overflow-visible md:pb-0">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group} className="shrink-0 space-y-1">
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                <ul className="flex gap-1 md:block md:space-y-0.5">
                  {SETTINGS_SECTIONS.filter((item) => item.group === group).map((item) => {
                    const Icon = SECTION_ICONS[item.id]
                    const current = item.id === active
                    return (
                      <li key={item.id}>
                        <Link
                          href={settingsHref(item.id)}
                          aria-current={current ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                            current
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <section aria-labelledby="settings-section-title" className="min-w-0 space-y-4">
          <div className="space-y-1">
            <h2 id="settings-section-title" className="text-lg font-semibold">
              {section.label}
            </h2>
            <p className="text-sm text-muted-foreground">{section.intro}</p>
          </div>
          {children}
        </section>
      </div>
    </div>
  )
}

function HowItWorks({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <section aria-labelledby="settings-how" className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="settings-how" className="text-sm font-semibold">
          {HOW_IT_WORKS_TITLE}
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Got it
        </Button>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {HOW_IT_WORKS_STEPS.map((step) => (
          <li key={step.title} className="space-y-1.5 rounded-md bg-muted/40 p-3">
            <p className="text-sm font-medium">{step.title}</p>
            <p className="text-xs text-muted-foreground">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
