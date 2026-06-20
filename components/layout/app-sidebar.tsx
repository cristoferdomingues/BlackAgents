"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Network,
  Plus,
  ScrollText,
  Settings,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { ARTIFACT_TYPE_LIST } from "@/lib/artifacts/constants"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const topNav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
]

const bottomNav: NavItem[] = [
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/standards", label: "Standards", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
]

function NavLink({
  item,
  active,
}: {
  item: NavItem
  active: boolean
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const { workspace, byType } = useWorkspace()

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-bold">B</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">BlackAgents</p>
          <p className="text-[11px] text-muted-foreground">Agent toolkit</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {topNav.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}

        <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Artifacts
        </div>

        {ARTIFACT_TYPE_LIST.map((meta) => {
          const Icon = meta.icon
          const href = `/${meta.route}`
          const active = isActive(href)
          const count = workspace ? byType(meta.type).length : 0
          return (
            <div key={meta.route} className="group/navitem relative">
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", meta.colorClass)} />
                <span className="flex-1">{meta.labelPlural}</span>
                {workspace ? (
                  <Badge
                    variant="secondary"
                    className="h-5 min-w-5 justify-center px-1.5 text-[11px] group-hover/navitem:opacity-0"
                  >
                    {count}
                  </Badge>
                ) : null}
              </Link>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 opacity-0 transition-opacity group-hover/navitem:opacity-100"
                aria-label={`New ${meta.label}`}
              >
                <Link href={`/${meta.route}/new`}>
                  <Plus className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          )
        })}

        <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Explore
        </div>
        {bottomNav.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <p className="truncate text-[11px] text-muted-foreground">
          {workspace ? workspace.path : "No workspace selected"}
        </p>
      </div>
    </aside>
  )
}
