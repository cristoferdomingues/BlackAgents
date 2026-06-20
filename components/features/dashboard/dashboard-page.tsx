"use client"

import Link from "next/link"
import { ArrowRight, FolderOpen, Loader2, Network } from "lucide-react"

import { cn } from "@/lib/utils"
import { ARTIFACT_TYPE_LIST } from "@/lib/artifacts/constants"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function DashboardPage() {
  const { workspace, loading, byType, artifacts } = useWorkspace()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading workspace…
      </div>
    )
  }

  if (!workspace) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FolderOpen className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold">No workspace selected</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Point BlackAgents at a project folder to manage its agents, commands,
          rules, and skills.
        </p>
        <Button asChild className="mt-6">
          <Link href="/settings">
            Select a workspace
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    )
  }

  const recent = [...artifacts]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground">
          {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"} across 4
          types
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ARTIFACT_TYPE_LIST.map((meta) => {
          const Icon = meta.icon
          const count = byType(meta.type).length
          return (
            <Link key={meta.route} href={`/${meta.route}`}>
              <Card className="transition-colors hover:border-primary/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {meta.labelPlural}
                  </CardTitle>
                  <Icon className={cn("h-4 w-4", meta.colorClass)} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{count}</div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {meta.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent artifacts</CardTitle>
            <CardDescription>Latest items in this workspace</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No artifacts found yet.
              </p>
            ) : (
              recent.map((artifact) => {
                const meta = ARTIFACT_TYPE_LIST.find(
                  (m) => m.type === artifact.type
                )!
                const Icon = meta.icon
                return (
                  <Link
                    key={`${artifact.type}:${artifact.name}`}
                    href={`/${meta.route}/${artifact.name}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted"
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", meta.colorClass)} />
                    <span className="text-sm font-medium">{artifact.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {artifact.description}
                    </span>
                  </Link>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Relationship graph</CardTitle>
            <CardDescription>
              Visualize how artifacts reference each other
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/graph">
                <Network className="h-4 w-4" />
                Open graph
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
