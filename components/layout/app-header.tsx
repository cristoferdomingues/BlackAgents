"use client"

import * as React from "react"
import Link from "next/link"
import { FolderOpen, Plus, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { ARTIFACT_TYPE_LIST } from "@/lib/artifacts/constants"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function AppHeader() {
  const { workspace, loadingArtifacts, refresh } = useWorkspace()

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-background/80 px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        {workspace ? (
          <span className="truncate text-sm font-medium">{workspace.name}</span>
        ) : (
          <Button asChild variant="link" size="sm" className="px-0">
            <Link href="/settings">Select a workspace</Link>
          </Button>
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
