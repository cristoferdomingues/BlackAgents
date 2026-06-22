"use client"

import * as React from "react"

import { apiFetch } from "@/lib/api"
import type { GraphData } from "@/lib/artifacts/types"

/**
 * Loads the artifact graph for the active workspace. Pass the workspace path so
 * the graph refetches whenever the active workspace changes (not just when one
 * is first selected) — otherwise switching workspaces leaves stale data.
 */
export function useGraph(workspacePath: string | null) {
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
    if (!workspacePath) {
      setData({ nodes: [], links: [] })
      return
    }
    void load()
  }, [workspacePath, load])

  return { data, loading, error, reload: load }
}
