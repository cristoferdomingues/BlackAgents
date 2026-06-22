"use client"

import * as React from "react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { Artifact, ArtifactType, Workspace } from "@/lib/artifacts/types"

interface WorkspaceState {
  active: Workspace | null
  workspaces: Workspace[]
}

interface WorkspaceContextValue {
  /** The active workspace (alias used throughout the UI). */
  workspace: Workspace | null
  /** All saved workspaces. */
  workspaces: Workspace[]
  artifacts: Artifact[]
  loading: boolean
  /** True while the artifact list is being (re)fetched. */
  loadingArtifacts: boolean
  error: string | null
  /** Add a workspace to the saved list (activates it if none is active). */
  addWorkspace: (path: string) => Promise<boolean>
  /** Switch the active workspace. */
  setActive: (path: string) => Promise<boolean>
  /** Remove a workspace from the saved list. */
  removeWorkspace: (path: string) => Promise<boolean>
  refresh: () => Promise<void>
  byType: (type: ArtifactType) => Artifact[]
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
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

  /** Apply a server state response and reload artifacts when the active changes. */
  const applyState = React.useCallback(
    async (state: WorkspaceState) => {
      const activeChanged = state.active?.path !== workspace?.path
      setWorkspace(state.active)
      setWorkspaces(state.workspaces)
      if (activeChanged) {
        if (state.active) await loadArtifacts()
        else setArtifacts([])
      }
    },
    [workspace?.path, loadArtifacts]
  )

  const bootstrap = React.useCallback(async () => {
    setLoading(true)
    try {
      const state = await apiFetch<WorkspaceState>("/api/workspace")
      setWorkspace(state.active)
      setWorkspaces(state.workspaces)
      if (state.active) await loadArtifacts()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace")
    } finally {
      setLoading(false)
    }
  }, [loadArtifacts])

  React.useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const mutate = React.useCallback(
    async (
      method: "POST" | "PUT" | "DELETE",
      path: string,
      success: (state: WorkspaceState) => string | null
    ) => {
      try {
        const state = await apiFetch<WorkspaceState>("/api/workspace", {
          method,
          body: JSON.stringify({ path }),
        })
        await applyState(state)
        const message = success(state)
        if (message) toast.success(message)
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Workspace action failed")
        return false
      }
    },
    [applyState]
  )

  const addWorkspace = React.useCallback(
    (path: string) =>
      mutate("POST", path, (s) => {
        const added = s.workspaces.find((w) => w.path !== workspace?.path)
        return `Added ${added?.name ?? "workspace"}`
      }),
    [mutate, workspace?.path]
  )

  const setActive = React.useCallback(
    (path: string) =>
      mutate("PUT", path, (s) =>
        s.active ? `Switched to ${s.active.name}` : null
      ),
    [mutate]
  )

  const removeWorkspace = React.useCallback(
    (path: string) => mutate("DELETE", path, () => "Workspace removed"),
    [mutate]
  )

  const byType = React.useCallback(
    (type: ArtifactType) => artifacts.filter((a) => a.type === type),
    [artifacts]
  )

  const value: WorkspaceContextValue = {
    workspace,
    workspaces,
    artifacts,
    loading,
    loadingArtifacts,
    error,
    addWorkspace,
    setActive,
    removeWorkspace,
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
