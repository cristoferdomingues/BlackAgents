"use client"

import * as React from "react"

import { apiFetch } from "@/lib/api"
import type { GraphData } from "@/lib/artifacts/types"

export function useGraph(enabled: boolean) {
  const [data, setData] = React.useState<GraphData>({ nodes: [], links: [] })
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await apiFetch<GraphData>("/api/graph"))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  return { data, loading, error, reload: load }
}
