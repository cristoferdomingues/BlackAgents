"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import type {
  ForceGraphMethods,
  ForceGraphProps,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d"

import { KNOWLEDGE_GRAPH_EMPTY, KNOWLEDGE_GRAPH_INTRO } from "@/lib/knowledge/explain"
import type { KnowledgeGraphLink, KnowledgeListItem } from "@/lib/knowledge/view"

type KnowledgeForceNode = KnowledgeListItem & Omit<NodeObject, "id"> & {
  degree: number
}

type KnowledgeForceLink = LinkObject<KnowledgeForceNode>

type KnowledgeForceGraph = React.ForwardRefExoticComponent<
  ForceGraphProps<KnowledgeForceNode, KnowledgeForceLink> &
    React.RefAttributes<ForceGraphMethods<KnowledgeForceNode, KnowledgeForceLink>>
>

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as KnowledgeForceGraph

interface GraphColors {
  node: string
  nodeMuted: string
  link: string
  pulse: string
  text: string
  ring: string
}

const FALLBACK_COLORS: GraphColors = {
  node: "rgb(139, 92, 246)",
  nodeMuted: "rgb(120, 120, 130)",
  link: "rgb(70, 70, 75)",
  pulse: "rgb(139, 92, 246)",
  text: "rgb(150, 150, 160)",
  ring: "rgb(235, 235, 240)",
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value ? `hsl(${value})` : fallback
}

function readColors(theme: string | undefined): GraphColors {
  void theme
  return {
    node: cssColor("--primary", "rgb(139, 92, 246)"),
    nodeMuted: cssColor("--muted-foreground", "rgb(120, 120, 130)"),
    link: cssColor("--border", "rgb(70, 70, 75)"),
    pulse: cssColor("--primary", "rgb(139, 92, 246)"),
    text: cssColor("--muted-foreground", "rgb(150, 150, 160)"),
    ring: cssColor("--foreground", "rgb(235, 235, 240)"),
  }
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)")
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true
  )
}

function linkId(value: KnowledgeForceLink["source"]): string {
  if (typeof value === "string" || typeof value === "number") return String(value)
  return value?.id ? String(value.id) : ""
}

function speedFor(link: KnowledgeForceLink): number {
  const text = `${linkId(link.source)}:${linkId(link.target)}`
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return 0.002 + (hash % 5) * 0.00045
}

export function KnowledgeGraph({
  concepts,
  links,
  selected,
  onOpen,
}: {
  concepts: KnowledgeListItem[]
  links: KnowledgeGraphLink[]
  selected: string | null
  onOpen: (id: string) => void
}): React.ReactElement {
  const { resolvedTheme } = useTheme()
  const reducedMotion = useReducedMotion()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const graphRef = React.useRef<ForceGraphMethods<KnowledgeForceNode, KnowledgeForceLink> | null>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const [hovered, setHovered] = React.useState<string | null>(null)
  const colors = React.useMemo(
    () => (typeof document === "undefined" ? FALLBACK_COLORS : readColors(resolvedTheme)),
    [resolvedTheme]
  )

  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  const data = React.useMemo(() => {
    const degree = new Map<string, number>()
    for (const link of links) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
    }
    const nodes = concepts.map((concept) => ({ ...concept, degree: degree.get(concept.id) ?? 0 }))
    return { nodes, links: links.map((link) => ({ ...link })) }
  }, [concepts, links])

  if (links.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-12 text-center">
        <p className="text-sm font-medium">No concept connections</p>
        <p className="mt-1 text-sm text-muted-foreground">{KNOWLEDGE_GRAPH_EMPTY}</p>
      </div>
    )
  }

  return (
    <section className="space-y-2" aria-label="Knowledge graph">
      <p className="text-sm text-muted-foreground">{KNOWLEDGE_GRAPH_INTRO}</p>
      <div ref={containerRef} className="relative h-[32rem] min-h-80 overflow-hidden rounded-md border bg-card">
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border bg-background/85 px-2.5 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {concepts.length} concepts · {links.length} links
          <br />
          Click a dot to read it in List.
        </div>
        <ul className="sr-only" aria-label="Concepts in graph">
          {concepts.map((concept) => (
            <li key={concept.id}>
              <button type="button" onClick={() => onOpen(concept.id)}>
                {concept.title}
              </button>
            </li>
          ))}
        </ul>
        {size.width > 0 ? (
          <ForceGraph2D
            ref={graphRef}
            width={size.width}
            height={size.height}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            linkColor={() => colors.link}
            linkWidth={(link: KnowledgeForceLink) => {
              const active = hovered && (linkId(link.source) === hovered || linkId(link.target) === hovered)
              return active ? 1.8 : 0.7
            }}
            linkDirectionalParticles={reducedMotion ? 0 : 1}
            linkDirectionalParticleColor={() => colors.pulse}
            linkDirectionalParticleWidth={1.8}
            linkDirectionalParticleSpeed={(link: KnowledgeForceLink) => speedFor(link)}
            onNodeHover={(node: KnowledgeForceNode | null) => setHovered(node?.id ?? null)}
            onNodeClick={(node: KnowledgeForceNode) => onOpen(node.id)}
            onEngineStop={() => graphRef.current?.zoomToFit?.(500, 48)}
            nodeCanvasObject={(node: KnowledgeForceNode, context: CanvasRenderingContext2D, globalScale: number) => {
              if (typeof node.x !== "number" || typeof node.y !== "number") return
              const radius = 3.5 + Math.sqrt(node.degree) * 1.2
              const active = hovered === node.id || selected === node.id
              const faded = hovered !== null && !active
              context.globalAlpha = faded ? 0.35 : node.degree === 0 ? 0.55 : 1
              context.beginPath()
              context.arc(node.x, node.y, radius, 0, Math.PI * 2)
              context.fillStyle = node.degree === 0 ? colors.nodeMuted : colors.node
              context.fill()
              if (active) {
                context.lineWidth = 1.5
                context.strokeStyle = colors.ring
                context.stroke()
              }
              context.globalAlpha = 1

              if (globalScale > 1.45 || active || node.degree >= 5) {
                const fontSize = Math.max(10 / globalScale, 2.5)
                context.font = `${fontSize}px Inter, sans-serif`
                context.textAlign = "center"
                context.textBaseline = "top"
                context.fillStyle = colors.text
                context.fillText(node.title, node.x, node.y + radius + 1)
              }
            }}
            nodePointerAreaPaint={(node: KnowledgeForceNode, color: string, context: CanvasRenderingContext2D) => {
              if (typeof node.x !== "number" || typeof node.y !== "number") return
              const radius = 5.5 + Math.sqrt(node.degree) * 1.2
              context.beginPath()
              context.arc(node.x, node.y, radius, 0, Math.PI * 2)
              context.fillStyle = color
              context.fill()
            }}
          />
        ) : null}
      </div>
    </section>
  )
}
