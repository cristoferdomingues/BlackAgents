"use client"

import * as React from "react"
import { AlertTriangle, List, Loader2, Network, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react"

import { apiFetch, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  actorLabel,
  groupKnowledge,
  KNOWLEDGE_LIBRARY_EMPTY,
  KNOWLEDGE_LIBRARY_INTRO,
  KNOWLEDGE_VALIDATION_INTRO,
  STATUS_LABEL,
  TRUST_LABEL,
} from "@/lib/knowledge/explain"
import { conceptOutline, withoutLeadingTitle, type OutlineItem } from "@/lib/knowledge/outline"
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
  | {
      kind: "ready"
      concepts: KnowledgeListItem[]
      links: KnowledgeLibraryView["links"]
      issues: KnowledgeLibraryView["issues"]
    }

type OpenState = { id: string; concept: KnowledgeConceptView } | { id: string; error: string }

type LibraryMode = "list" | "graph"

/** Browse and read concepts that are already saved in this workspace. */
export function KnowledgeLibrary(): React.ReactElement {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" })
  const [mode, setMode] = React.useState<LibraryMode>("list")
  const [query, setQuery] = React.useState("")
  const [selected, setSelected] = React.useState<string | null>(null)
  const [opened, setOpened] = React.useState<OpenState | null>(null)
  const [listOpen, setListOpen] = React.useState(true)
  const [reload, setReload] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    apiFetch<KnowledgeLibraryView>("/api/knowledge")
      .then((data) => {
        if (!cancelled) {
          setState({
            kind: "ready",
            concepts: data.concepts,
            links: data.links ?? [],
            issues: data.issues ?? [],
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorText(err, "Could not load knowledge") })
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  const concepts = state.kind === "ready" ? state.concepts : []
  const links = state.kind === "ready" ? state.links : []
  const issues = state.kind === "ready" ? state.issues : []
  const active = selected ?? groupKnowledge(concepts)[0]?.items[0]?.id ?? null

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
    apiFetch<KnowledgeConceptView>(`/api/knowledge?id=${encodeURIComponent(active)}`)
      .then((concept) => {
        if (!cancelled) setOpened({ id: active, concept })
      })
      .catch((err: unknown) => {
        if (!cancelled) setOpened({ id: active, error: errorText(err, "Could not open that concept") })
      })
    return () => {
      cancelled = true
    }
  }, [active, reload])

  function retry(): void {
    setState({ kind: "loading" })
    setReload((count) => count + 1)
  }

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? concepts.filter((item) =>
        [item.title, item.id, item.description, item.type, ...item.tags].join(" ").toLowerCase().includes(needle)
      )
    : concepts
  const groups = groupKnowledge(visible)
  const current = opened && opened.id === active ? opened : null

  return (
    <section className="space-y-3" aria-label="Knowledge library">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{KNOWLEDGE_LIBRARY_INTRO}</p>
          {state.kind === "ready" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {concepts.length} saved {concepts.length === 1 ? "concept" : "concepts"}
              {issues.length > 0 ? ` · ${issues.length} invalid ${issues.length === 1 ? "file" : "files"}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state.kind === "ready" && concepts.length > 0 ? (
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
          ) : null}
          <Button type="button" size="sm" variant="outline" disabled={state.kind === "loading"} onClick={retry}>
            <RefreshCw className="h-4 w-4" />
            Check files
          </Button>
        </div>
      </div>
      {state.kind === "loading" ? <Skeleton className="h-24 w-full" /> : null}
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}{" "}
          <Button variant="link" size="sm" onClick={retry}>
            Retry
          </Button>
        </p>
      ) : null}
      {state.kind === "ready" && issues.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {issues.length} knowledge {issues.length === 1 ? "file needs" : "files need"} attention
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{KNOWLEDGE_VALIDATION_INTRO}</p>
              <ul className="mt-2 space-y-1.5">
                {issues.map((issue) => (
                  <li key={issue.file} className="text-xs">
                    <code className="break-all">{issue.file}</code>
                    <span className="block text-destructive">{issue.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
      {state.kind === "ready" && concepts.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {KNOWLEDGE_LIBRARY_EMPTY}
        </p>
      ) : null}
      {state.kind === "ready" && concepts.length > 0 ? (
        mode === "graph" ? (
          <KnowledgeGraph
            concepts={concepts}
            links={links}
            selected={active}
            onOpen={(id) => {
              setMode("list")
              setSelected(id)
            }}
          />
        ) : (
          <div className={cn("grid gap-4", listOpen && "lg:grid-cols-[17rem_minmax(0,1fr)]")}>
            {listOpen ? (
              <aside aria-label="Concepts" className="space-y-2 lg:sticky lg:top-4 lg:self-start">
                <Input
                  value={query}
                  placeholder="Search concepts"
                  aria-label="Search concepts"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No concept matches that search.</p>
                ) : (
                  <div className="max-h-[calc(100vh-12rem)] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
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
                                  active === item.id && "bg-muted font-medium"
                                )}
                                aria-current={active === item.id ? "true" : undefined}
                                onClick={() => setSelected(item.id)}
                              >
                                <span className="block truncate">{item.title}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {item.description || item.id}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            ) : null}
            <div className="min-w-0 rounded-lg border">
              <div className="flex items-center border-b px-2 py-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={listOpen}
                  onClick={() => setListOpen((open) => !open)}
                >
                  {listOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                  {listOpen ? "Hide list" : "Show list"}
                </Button>
              </div>
              <div className="p-4 sm:p-6">
                {!active ? (
                  <p className="text-sm text-muted-foreground">Choose a concept to read it.</p>
                ) : !current ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Opening concept" />
                ) : "error" in current ? (
                  <p role="alert" className="text-sm text-destructive">
                    {current.error}
                  </p>
                ) : (
                  <ConceptReader concept={current.concept} listOpen={listOpen} onOpen={setSelected} />
                )}
              </div>
            </div>
          </div>
        )
      ) : null}
    </section>
  )
}

function ConceptReader({
  concept,
  listOpen,
  onOpen,
}: {
  concept: KnowledgeConceptView
  /** With the concept list open the outline waits for a wider screen, so the text keeps room. */
  listOpen: boolean
  onOpen: (id: string) => void
}): React.ReactElement {
  const articleRef = React.useRef<HTMLElement>(null)
  const body = withoutLeadingTitle(concept.body, concept.title)
  const outline = conceptOutline(body)

  function jump(item: OutlineItem): void {
    const headings = articleRef.current?.querySelectorAll<HTMLElement>(`h${item.level}`) ?? []
    const target = [...headings].find((heading) => heading.textContent?.trim() === item.text)
    target?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div
      className={cn(
        "grid gap-8",
        outline.length > 1 &&
          (listOpen ? "2xl:grid-cols-[minmax(0,1fr)_13rem]" : "xl:grid-cols-[minmax(0,1fr)_13rem]")
      )}
    >
      <article ref={articleRef} className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
        <header className="space-y-3 border-b pb-4">
          <h2 className="text-2xl font-semibold tracking-tight">{concept.title}</h2>
          {concept.description ? <p className="text-base text-muted-foreground">{concept.description}</p> : null}
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
        <MarkdownPreview content={body} variant="reader" fromId={concept.id} openConcept={onOpen} />
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
      {outline.length > 1 ? (
        <nav
          aria-label="On this page"
          className={cn(
            "hidden",
            listOpen ? "2xl:sticky 2xl:top-4 2xl:block 2xl:self-start" : "xl:sticky xl:top-4 xl:block xl:self-start"
          )}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</p>
          <ul className="max-h-[calc(100vh-8rem)] space-y-1 overflow-y-auto border-l text-sm scrollbar-thin">
            {outline.map((item, index) => (
              <li key={`${index}-${item.text}`}>
                <button
                  type="button"
                  onClick={() => jump(item)}
                  className={cn(
                    "-ml-px block w-full border-l border-transparent py-0.5 text-left text-muted-foreground hover:border-foreground hover:text-foreground",
                    item.level === 2 ? "pl-3" : "pl-6 text-xs"
                  )}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}
