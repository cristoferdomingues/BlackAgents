"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { ARTIFACT_TYPE_LIST, metaForType } from "@/lib/artifacts/constants"
import type { ArtifactType, GraphNode } from "@/lib/artifacts/types"
import { useWorkspace } from "@/components/providers/workspace-provider"
import { useGraph } from "@/hooks/use-graph"
import { NoWorkspace } from "@/components/features/artifacts/no-workspace"

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
})

type ForceNode = GraphNode & { x?: number; y?: number }

function readTypeColors(): Record<ArtifactType, string> {
  const styles = getComputedStyle(document.documentElement)
  const read = (v: string) => `hsl(${styles.getPropertyValue(v).trim()})`
  return {
    agent: read("--type-agent"),
    command: read("--type-command"),
    rule: read("--type-rule"),
    skill: read("--type-skill"),
  }
}

function readUiColors() {
  const styles = getComputedStyle(document.documentElement)
  return {
    link: `hsl(${styles.getPropertyValue("--border").trim()})`,
    text: `hsl(${styles.getPropertyValue("--muted-foreground").trim()})`,
  }
}

export function GraphView() {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const { workspace, loading: wsLoading } = useWorkspace()
  const { data, loading, error } = useGraph(workspace?.path ?? null)

  const containerRef = React.useRef<HTMLDivElement>(null)
  const fgRef = React.useRef<any>(null)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const [hovered, setHovered] = React.useState<string | null>(null)
  const [enabled, setEnabled] = React.useState<Record<ArtifactType, boolean>>({
    agent: true,
    command: true,
    rule: true,
    skill: true,
  })

  const [colors, setColors] = React.useState<Record<ArtifactType, string>>({
    agent: "#a78bfa",
    command: "#38bdf8",
    rule: "#fbbf24",
    skill: "#34d399",
  })
  const [uiColors, setUiColors] = React.useState({
    link: "rgba(150,150,150,0.25)",
    text: "#888",
  })

  React.useEffect(() => {
    // Resolve theme colors after mount and whenever the theme flips.
    setColors(readTypeColors())
    setUiColors(readUiColors())
  }, [resolvedTheme])

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    observer.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  // Stable node objects so the simulation keeps positions across filters.
  const masterRef = React.useRef<{
    nodes: Map<string, ForceNode>
    raw: typeof data
  }>({ nodes: new Map(), raw: { nodes: [], links: [] } })

  React.useMemo(() => {
    const map = new Map<string, ForceNode>()
    for (const node of data.nodes) {
      const existing = masterRef.current.nodes.get(node.id)
      map.set(node.id, existing ? Object.assign(existing, node) : { ...node })
    }
    masterRef.current = { nodes: map, raw: data }
  }, [data])

  const filtered = React.useMemo(() => {
    const nodes = data.nodes
      .filter((n) => enabled[n.type])
      .map((n) => masterRef.current.nodes.get(n.id)!)
    const allowed = new Set(nodes.map((n) => n.id))
    const links = data.links
      .filter((l) => {
        const s = typeof l.source === "object" ? (l.source as any).id : l.source
        const t = typeof l.target === "object" ? (l.target as any).id : l.target
        return allowed.has(s) && allowed.has(t)
      })
      .map((l) => ({ ...l }))
    return { nodes, links }
  }, [data, enabled])

  if (!workspace && !wsLoading) {
    return <NoWorkspace message="Select a workspace to visualize its artifact graph." />
  }

  const counts = data.nodes.reduce(
    (acc, n) => {
      acc[n.type] += 1
      return acc
    },
    { agent: 0, command: 0, rule: 0, skill: 0 } as Record<ArtifactType, number>
  )

  return (
    <div className="relative h-full w-full overflow-hidden" ref={containerRef}>
      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Building graph…
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Legend / filters */}
      <div className="absolute left-4 top-4 z-10 rounded-lg border bg-background/90 p-3 text-sm shadow-sm backdrop-blur">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Types
        </p>
        <div className="space-y-1.5">
          {ARTIFACT_TYPE_LIST.map((meta) => (
            <button
              key={meta.type}
              onClick={() =>
                setEnabled((e) => ({ ...e, [meta.type]: !e[meta.type] }))
              }
              className={cn(
                "flex w-full items-center gap-2 rounded px-1.5 py-1 transition-opacity",
                !enabled[meta.type] && "opacity-40"
              )}
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: colors[meta.type] }}
              />
              <span className="flex-1 text-left">{meta.labelPlural}</span>
              <span className="text-xs text-muted-foreground">
                {counts[meta.type]}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
          {filtered.links.length} connections · click a node to open
        </p>
      </div>

      {size.width > 0 ? (
        <ForceGraph2D
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={filtered}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={4}
          nodeVal={(n: any) => 1 + (n.degree ?? 0)}
          linkColor={() => uiColors.link}
          linkWidth={(l: any) =>
            hovered &&
            ((typeof l.source === "object" ? l.source.id : l.source) ===
              hovered ||
              (typeof l.target === "object" ? l.target.id : l.target) ===
                hovered)
              ? 2
              : 1
          }
          linkDirectionalParticles={0}
          onNodeHover={(n: any) => setHovered(n ? n.id : null)}
          onNodeClick={(n: any) => {
            const meta = metaForType(n.type as ArtifactType)
            router.push(`/${meta.route}/${n.name}`)
          }}
          onEngineStop={() => fgRef.current?.zoomToFit?.(400, 60)}
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const radius = 3 + Math.sqrt(node.degree ?? 0) * 1.4
            const isHovered = hovered === node.id
            ctx.beginPath()
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI)
            ctx.fillStyle = colors[node.type as ArtifactType]
            ctx.globalAlpha = hovered && !isHovered ? 0.55 : 1
            ctx.fill()
            if (isHovered) {
              ctx.lineWidth = 1.5
              ctx.strokeStyle = uiColors.text
              ctx.stroke()
            }
            ctx.globalAlpha = 1

            const showLabel = globalScale > 1.3 || isHovered || (node.degree ?? 0) >= 6
            if (showLabel) {
              const fontSize = Math.max(10 / globalScale, 2.5)
              ctx.font = `${fontSize}px Inter, sans-serif`
              ctx.textAlign = "center"
              ctx.textBaseline = "top"
              ctx.fillStyle = uiColors.text
              ctx.fillText(node.name, node.x, node.y + radius + 1)
            }
          }}
          nodePointerAreaPaint={(node: any, color, ctx) => {
            const radius = 3 + Math.sqrt(node.degree ?? 0) * 1.4 + 2
            ctx.beginPath()
            ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI)
            ctx.fillStyle = color
            ctx.fill()
          }}
        />
      ) : null}
    </div>
  )
}
