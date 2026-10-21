"use client"

import * as React from "react"
import { ChevronRight, File, Folder, Lock } from "lucide-react"

import { apiFetch, ApiError } from "@/lib/api"
import type { TreeEntry } from "@/lib/k0ding/schema"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface FileTreeProps {
  rootId: string
  showHidden: boolean
  activePath: string | null
  changed?: readonly string[]
  onOpen: (path: string) => void
}

export function FileTree({ rootId, showHidden, activePath, changed = [], onOpen }: FileTreeProps): React.ReactElement {
  return (
    <div className="p-1">
      <TreeDir rootId={rootId} dir="" showHidden={showHidden} activePath={activePath} changed={changed} onOpen={onOpen} depth={0} />
    </div>
  )
}

function isChanged(path: string, kind: "dir" | "file", changed: readonly string[]): boolean {
  if (kind === "file") return changed.includes(path)
  return changed.some((item) => item === path || item.startsWith(`${path}/`))
}

function TreeDir({
  rootId,
  dir,
  showHidden,
  activePath,
  changed = [],
  onOpen,
  depth,
}: FileTreeProps & { dir: string; depth: number }): React.ReactElement {
  const [entries, setEntries] = React.useState<TreeEntry[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ dir, hidden: showHidden ? "1" : "0" })
    apiFetch<{ entries: TreeEntry[] }>(`/api/k0ding/roots/${rootId}/tree?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          setEntries(data.entries)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not read this folder")
      })
    return () => {
      cancelled = true
    }
  }, [rootId, dir, showHidden])

  if (error) return <p className="px-2 py-1 text-xs text-destructive">{error}</p>
  if (!entries) return <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
  if (entries.length === 0) return <p className="px-2 py-1 text-xs text-muted-foreground">Empty folder</p>

  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => {
        const expanded = open[entry.path] === true
        return (
          <li key={entry.path}>
            {entry.kind === "dir" ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full justify-start px-1 font-normal"
                  style={{ paddingLeft: `${depth * 12 + 4}px` }}
                  aria-expanded={expanded}
                  onClick={() => setOpen((current) => ({ ...current, [entry.path]: !expanded }))}
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                  {isChanged(entry.path, "dir", changed) ? (
                    <span aria-hidden className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" />
                  ) : null}
                </Button>
                {expanded ? (
                  <TreeDir
                    rootId={rootId}
                    dir={entry.path}
                    showHidden={showHidden}
                    activePath={activePath}
                    changed={changed}
                    onOpen={onOpen}
                    depth={depth + 1}
                  />
                ) : null}
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-full justify-start px-1 font-normal",
                  activePath === entry.path && "bg-accent text-accent-foreground"
                )}
                style={{ paddingLeft: `${depth * 12 + 22}px` }}
                onClick={() => onOpen(entry.path)}
              >
                {entry.secret ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{entry.name}</span>
                {isChanged(entry.path, "file", changed) ? (
                  <span aria-hidden className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" />
                ) : null}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
