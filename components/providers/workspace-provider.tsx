"use client"

import * as React from "react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { Artifact, ArtifactType, Workspace } from "@/lib/artifacts/types"

interface WorkspaceState {
  workspace: Workspace | null
  recents: Workspace[]
}

interface WorkspaceContextValue {
  workspace: Workspace | null
  recents: Workspace[]
  artifacts: Artifact[]
  loading: boolean
  /** True while the artifact list is being (re)fetched. */
  loadingArtifacts: boolean
  error: string | null
  selectWorkspace: (path: string) => Promise<boolean>
  refresh: () => Promise<void>
  byType: (type: ArtifactType) => Artifact[]
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [recents, setRecents] = React.useState<Workspace[]>([])
  const [artifacts, setArtifacts] = React.useState<Artifact[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingArtifacts, setLoadingArtifacts] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadArtifacts = React.useCallback(async () => {
    setLoadingArtifacts(true)
    setError(null)
    try {
      const data = await apiFetch<Artifact[]>("/api/artifacts")
      setArtifacts(data)
    } catch (err) {
      setArtifacts([])
      setError(err instanceof Error ? err.message : "Failed to load artifacts")
    } finally {
      setLoadingArtifacts(false)
    }
  }, [])

  const bootstrap = React.useCallback(async () => {
    setLoading(true)
    try {
      const state = await apiFetch<WorkspaceState>("/api/workspace")
      setWorkspace(state.workspace)
      setRecents(state.recents)
      if (state.workspace) {
        await loadArtifacts()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace")
    } finally {
      setLoading(false)
    }
  }, [loadArtifacts])

  React.useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const selectWorkspace = React.useCallback(
    async (path: string) => {
      try {
        const state = await apiFetch<WorkspaceState>("/api/workspace", {
          method: "POST",
          body: JSON.stringify({ path }),
        })
        setWorkspace(state.workspace)
        setRecents(state.recents)
        await loadArtifacts()
        toast.success(`Workspace set to ${state.workspace?.name}`)
        return true
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not open workspace"
        )
        return false
      }
    },
    [loadArtifacts]
  )

  const byType = React.useCallback(
    (type: ArtifactType) => artifacts.filter((a) => a.type === type),
    [artifacts]
  )

  const value: WorkspaceContextValue = {
    workspace,
    recents,
    artifacts,
    loading,
    loadingArtifacts,
    error,
    selectWorkspace,
    refresh: loadArtifacts,
    byType,
  }

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider")
  }
  return ctx
}
