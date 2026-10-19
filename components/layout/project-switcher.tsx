"use client"

import * as React from "react"
import Link from "next/link"
import { Boxes, Check, ChevronsUpDown, Settings } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  inheritsSummary,
  WORKSPACE_MODE_HELP,
  WORKSPACE_MODE_LABEL,
} from "@/lib/artifacts/projects-explain"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** Header control: choose a project inside the active workspace, or the whole workspace. */
export function ProjectSwitcher(): React.ReactElement | null {
  const { workspace, projects, project, setActiveProject } = useWorkspace()
  if (!workspace) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-[14rem] gap-2 px-2"
          aria-label={`Project: ${project?.name ?? WORKSPACE_MODE_LABEL}. Switch project`}
        >
          <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate text-sm", project ? "font-medium" : "text-muted-foreground")}>
            {project?.name ?? WORKSPACE_MODE_LABEL}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Switch project</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ProjectItem
          active={!project}
          title={WORKSPACE_MODE_LABEL}
          detail={WORKSPACE_MODE_HELP}
          onSelect={() => {
            if (project) void setActiveProject(null)
          }}
        />
        {projects.map((p) => (
          <ProjectItem
            key={p.id}
            active={project?.id === p.id}
            title={p.name}
            detail={inheritsSummary(p.inherits)}
            onSelect={() => {
              if (project?.id !== p.id) void setActiveProject(p.id)
            }}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=open#projects" className="gap-2">
            <Settings className="h-4 w-4" />
            Manage projects
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectItem({
  active,
  title,
  detail,
  onSelect,
}: {
  active: boolean
  title: string
  detail: string
  onSelect: () => void
}): React.ReactElement {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2">
      <Check className={cn("h-4 w-4 shrink-0", active ? "text-primary opacity-100" : "opacity-0")} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </DropdownMenuItem>
  )
}
