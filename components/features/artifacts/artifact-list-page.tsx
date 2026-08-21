"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, MessageCircle, Plus, Search, ShieldAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { metaForType } from "@/lib/artifacts/constants"
import type { ArtifactType } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"
import { ArtifactBadges } from "@/components/features/artifacts/artifact-badges"
import { useProviderReadiness } from "@/components/features/providers/provider-readiness"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function ArtifactListPage({ type }: { type: ArtifactType }) {
  const meta = metaForType(type)
  const Icon = meta.icon
  const router = useRouter()
  const { workspace, byType, loading, loadingArtifacts } = useWorkspace()
  const [query, setQuery] = React.useState("")
  const providerReadiness = useProviderReadiness(type === "agent")
  const showChatAction = type === "agent"
  const columnCount = showChatAction ? 4 : 3

  const items = React.useMemo(() => {
    const list = byType(type)
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
    )
  }, [byType, type, query])

  if (!workspace && !loading) {
    return <NoWorkspace message={`Select a workspace to manage ${meta.labelPlural.toLowerCase()}.`} />
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Icon className={cn("h-5 w-5", meta.colorClass)} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {meta.labelPlural}
            </h1>
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          </div>
        </div>
        <Button asChild>
          <Link href={`/${meta.route}/new`}>
            <Plus className="h-4 w-4" />
            New {meta.label}
          </Link>
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={`Search ${meta.labelPlural.toLowerCase()}…`}
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[240px]">Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[180px]">Tags</TableHead>
              {showChatAction ? (
                <TableHead className="w-[190px] text-right">Actions</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingArtifacts && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="h-24 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="h-28 text-center text-sm text-muted-foreground"
                >
                  {query
                    ? "No matches."
                    : `No ${meta.labelPlural.toLowerCase()} yet. Create your first one.`}
                </TableCell>
              </TableRow>
            ) : (
              items.map((artifact) => (
                <TableRow
                  key={artifact.name}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(`/${meta.route}/${artifact.name}`)
                  }
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", meta.colorClass)} />
                      {artifact.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="line-clamp-1">{artifact.description}</span>
                  </TableCell>
                  <TableCell>
                    <ArtifactBadges artifact={artifact} />
                  </TableCell>
                  {showChatAction ? (
                    <TableCell className="text-right">
                      {providerReadiness.loading ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled
                          aria-label={`Checking chat availability for ${artifact.name}`}
                        >
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Checking
                        </Button>
                      ) : providerReadiness.hasVerifiedProvider ? (
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/chat?agent=${encodeURIComponent(artifact.name)}`}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Chat with ${artifact.name}`}
                          >
                            <MessageCircle className="h-4 w-4" />
                            Chat
                          </Link>
                        </Button>
                      ) : (
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href="/providers"
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Verify a provider to chat with ${artifact.name}`}
                          >
                            <ShieldAlert className="h-4 w-4" />
                            Verify provider
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
