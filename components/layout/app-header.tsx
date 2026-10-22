"use client"

import * as React from "react"
import Link from "next/link"
import { Check, ChevronsUpDown, FolderOpen, FolderPlus, PanelLeft, Plus, RefreshCw, Settings, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { ARTIFACT_TYPE_LIST } from "@/lib/artifacts/constants"
import { settingsHref } from "@/lib/settings/sections"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { useWorkspaceDialogs } from "@/components/features/workspace/workspace-dialogs"
import { useSidebar } from "@/components/layout/sidebar-provider"
import { ProjectSwitcher } from "@/components/layout/project-switcher"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function AppHeader() {
  const { workspace, workspaces, setActive, loadingArtifacts, refresh } =
    useWorkspace()
  const { openCreate, openExisting } = useWorkspaceDialogs()
  const { open: sidebarOpen, toggle: toggleSidebar } = useSidebar()
  const sidebarLabel = sidebarOpen ? "Hide sidebar" : "Show sidebar"

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden shrink-0 md:inline-flex"
              aria-label={sidebarLabel}
              aria-expanded={sidebarOpen}
              aria-controls="app-sidebar"
              onClick={toggleSidebar}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{sidebarLabel}</TooltipContent>
        </Tooltip>
        {workspace ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="min-w-0 max-w-[18rem] gap-2 px-2"
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {workspace.name}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workspaces.map((ws) => {
                const isActive = ws.path === workspace.path
                return (
                  <DropdownMenuItem
                    key={ws.path}
                    onSelect={() => {
                      if (!isActive) void setActive(ws.path)
                    }}
                    className="gap-2"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "opacity-100 text-primary" : "opacity-0"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{ws.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {ws.path}
                      </p>
                    </div>
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openCreate} className="gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                New workspace…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={openExisting} className="gap-2">
                <FolderPlus className="h-4 w-4" />
                Open folder…
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={settingsHref("workspaces")} className="gap-2">
                  <Settings className="h-4 w-4" />
                  Manage workspaces
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {workspace ? (
          <>
            <span className="text-muted-foreground" aria-hidden>
              /
            </span>
            <ProjectSwitcher />
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={openCreate}>
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              New workspace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground"
              onClick={openExisting}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open folder
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {workspace ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh artifacts"
            onClick={() => refresh()}
          >
            <RefreshCw
              className={cn("h-4 w-4", loadingArtifacts && "animate-spin")}
            />
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={!workspace}>
              <Plus className="h-4 w-4" />
              New
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Create artifact</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ARTIFACT_TYPE_LIST.map((meta) => {
              const Icon = meta.icon
              return (
                <DropdownMenuItem key={meta.route} asChild>
                  <Link href={`/${meta.route}/new`}>
                    <Icon className={cn("h-4 w-4", meta.colorClass)} />
                    New {meta.label}
                  </Link>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/new">
                <Plus className="h-4 w-4" />
                Guided wizard
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ThemeToggle />
      </div>
    </header>
  )
}
