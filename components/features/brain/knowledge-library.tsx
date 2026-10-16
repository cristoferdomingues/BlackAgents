"use client"

import * as React from "react"
import { List, Loader2, Network } from "lucide-react"

import { apiFetch, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  actorLabel,
  groupKnowledge,
  KNOWLEDGE_LIBRARY_EMPTY,
  KNOWLEDGE_LIBRARY_INTRO,
  STATUS_LABEL,
  TRUST_LABEL,
} from "@/lib/knowledge/explain"
import type { KnowledgeConceptView, KnowledgeLibraryView, KnowledgeListItem } from "@/lib/knowledge/view"
import { KnowledgeGraph } from "@/components/features/brain/knowledge-graph"
import { MarkdownPreview } from "@/components/features/editor/markdown-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; concepts: KnowledgeListItem[]; links: KnowledgeLibraryView["links"] }

type LibraryMode = "list" | "graph"

/** Browse and read concepts that are already saved in this workspace. */
export function KnowledgeLibrary(): React.ReactElement {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" })
  const [mode, setMode] = React.useState<LibraryMode>("list")
  const [query, setQuery] = React.useState("")
  const [selected, setSelected] = React.useState<string | null>(null)
  const [concept, setConcept] = React.useState<KnowledgeConceptView | null>(null)
  const [opening, setOpening] = React.useState(false)
  const [openError, setOpenError] = React.useState<string | null>(null)
  const [reload, setReload] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    apiFetch<KnowledgeLibraryView>("/api/knowledge")
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", concepts: data.concepts, links: data.links ?? [] })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorText(err, "Could not load knowledge") })
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  function retry(): void {
    setState({ kind: "loading" })
    setReload((count) => count + 1)
  }

  async function open(id: string): Promise<void> {
    setSelected(id)
    setOpening(true)
    setOpenError(null)
    try {
      const data = await apiFetch<KnowledgeConceptView>(`/api/knowledge?id=${encodeURIComponent(id)}`)
      setConcept(data)
    } catch (err) {
      setConcept(null)
      setOpenError(errorText(err, "Could not open that concept"))
    } finally {
      setOpening(false)
    }
  }

  const concepts = state.kind === "ready" ? state.concepts : []
  const links = state.kind === "ready" ? state.links : []
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? concepts.filter((item) =>
        [item.title, item.id, item.description, item.type, ...item.tags].join(" ").toLowerCase().includes(needle)
      )
    : concepts
  const groups = groupKnowledge(visible)

  return (
    <section className="space-y-3" aria-label="Knowledge library">
      <p className="text-sm text-muted-foreground">{KNOWLEDGE_LIBRARY_INTRO}</p>
      {state.kind === "loading" ? <Skeleton className="h-24 w-full" /> : null}
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}{" "}
          <Button variant="link" size="sm" onClick={retry}>
            Retry
          </Button>
        </p>
      ) : null}
      {state.kind === "ready" && concepts.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {KNOWLEDGE_LIBRARY_EMPTY}
        </p>
      ) : null}
      {state.kind === "ready" && concepts.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {mode === "list" ? "Browse and read saved concepts." : "Explore links between saved concepts."}
            </p>
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Knowledge view">
              <Button
                type="button"
                size="sm"
                variant={mode === "list" ? "secondary" : "ghost"}
                aria-pressed={mode === "list"}
                onClick={() => setMode("list")}
              >
                <List className="h-4 w-4" />
                List
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "graph" ? "secondary" : "ghost"}
                aria-pressed={mode === "graph"}
                onClick={() => setMode("graph")}
              >
                <Network className="h-4 w-4" />
                Graph
              </Button>
            </div>
          </div>
          {mode === "graph" ? (
            <KnowledgeGraph
              concepts={concepts}
              links={links}
              selected={selected}
              onOpen={(id) => {
                setMode("list")
                void open(id)
              }}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <div className="space-y-2">
            <Input
              value={query}
              placeholder="Search concepts"
              aria-label="Search concepts"
              onChange={(event) => setQuery(event.target.value)}
            />
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No concept matches that search.</p>
            ) : (
              <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {groups.map((group) => (
                  <div key={group.folder || "top"}>
                    <p className="px-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                    <ul className="mt-1 space-y-1">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={cn(
                              "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                              selected === item.id && "bg-muted font-medium"
                            )}
                            aria-current={selected === item.id ? "true" : undefined}
                            onClick={() => void open(item.id)}
                          >
                            <span className="block truncate">{item.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{item.description || item.id}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
              </div>
              <div className="min-w-0 rounded-md border p-4">
            {!selected ? (
              <p className="text-sm text-muted-foreground">Choose a concept to read it.</p>
            ) : opening ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Opening concept" />
            ) : openError ? (
              <p role="alert" className="text-sm text-destructive">
                {openError}
              </p>
            ) : concept ? (
              <article className="space-y-3">
                <header className="space-y-2">
                  <h2 className="text-lg font-semibold">{concept.title}</h2>
                  <p className="text-sm text-muted-foreground">{concept.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">{concept.type}</Badge>
                    <Badge variant="outline">{TRUST_LABEL[concept.trust]}</Badge>
                    {concept.status === "stable" || concept.status === "deprecated" ? (
                      <Badge variant="outline">{STATUS_LABEL[concept.status]}</Badge>
                    ) : null}
                    {concept.status === "draft" && concept.trust !== "human-reviewed" ? (
                      <Badge variant="outline">{STATUS_LABEL.draft}</Badge>
                    ) : null}
                    {concept.stale ? <Badge variant="destructive">Needs a check</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saved at <code>{concept.file}</code>
                    {concept.generatedBy ? `. ${actorLabel(concept.generatedBy)}.` : "."}
                  </p>
                </header>
                <MarkdownPreview
                  content={concept.body}
                  variant="inline"
                  fromId={concept.id}
                  openConcept={(id) => void open(id)}
                />
                {concept.sources.length > 0 ? (
                  <div className="space-y-1 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">Sources</p>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {concept.sources.map((source) => (
                        <li key={source.resource}>
                          {/^[a-z]+:/i.test(source.resource) && !source.resource.startsWith("file:") ? (
                            <a href={source.resource} className="underline" target="_blank" rel="noreferrer">
                              {source.title || source.resource}
                            </a>
                          ) : (
                            <span>{source.title || source.resource}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ) : null}
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
