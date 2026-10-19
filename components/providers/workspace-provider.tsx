"use client"

import * as React from "react"
import { toast } from "sonner"

import { apiFetch } from "@/lib/api"
import type { InvalidProject, ProjectScope } from "@/lib/artifacts/projects"
import { withScope } from "@/lib/artifacts/projects-explain"
import type { WorkspaceTemplate } from "@/lib/artifacts/schemas"
import type { Artifact, ArtifactType, Workspace } from "@/lib/artifacts/types"

interface WorkspaceState {
  active: Workspace | null
  workspaces: Workspace[]
}

interface ProjectsState {
  projects: ProjectScope[]
  invalid: InvalidProject[]
  activeProject: string | null
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
  /** Create a new workspace directory and scaffold starter artifacts from a template. */
  createWorkspace: (
    path: string,
    template?: WorkspaceTemplate
  ) => Promise<boolean>
  /** Switch the active workspace. */
  setActive: (path: string) => Promise<boolean>
  /** Remove a workspace from the saved list. */
  removeWorkspace: (path: string) => Promise<boolean>
  refresh: () => Promise<void>
  byType: (type: ArtifactType) => Artifact[]
  /** Valid projects of the active workspace. */
  projects: ProjectScope[]
  /** Project folders that failed to load (fail closed), with the reason. */
  invalidProjects: InvalidProject[]
  /** The active project, or null in whole-workspace mode. */
  project: ProjectScope | null
  /** Activate a project id, or null for the whole workspace. */
  setActiveProject: (id: string | null) => Promise<boolean>
  /** Reload the project list (after create, edit, or delete). */
  refreshProjects: () => Promise<void>
  /** Add `?scope=` for the active project to an artifact API URL. */
  scoped: (url: string) => string
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null)
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [artifacts, setArtifacts] = React.useState<Artifact[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingArtifacts, setLoadingArtifacts] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [projectsState, setProjectsState] = React.useState<ProjectsState>({
    projects: [],
    invalid: [],
    activeProject: null,
  })
  const activeProjectRef = React.useRef<string | null>(null)

  const loadArtifacts = React.useCallback(async (projectId?: string | null) => {
    const scope = projectId === undefined ? activeProjectRef.current : projectId
    setLoadingArtifacts(true)
    setError(null)
    try {
      const data = await apiFetch<Artifact[]>(withScope("/api/artifacts", scope))
      setArtifacts(data)
    } catch (err) {
      setArtifacts([])
      setError(err instanceof Error ? err.message : "Failed to load artifacts")
    } finally {
      setLoadingArtifacts(false)
    }
  }, [])

  /** Load projects; an active id that no longer loads falls back to the whole workspace. */
  const loadProjects = React.useCallback(async (): Promise<ProjectScope | null> => {
    try {
      const state = await apiFetch<ProjectsState>("/api/projects")
      const active = state.projects.find((p) => p.id === state.activeProject) ?? null
      activeProjectRef.current = active?.id ?? null
      setProjectsState({ ...state, activeProject: active?.id ?? null })
      return active
    } catch {
      activeProjectRef.current = null
      setProjectsState({ projects: [], invalid: [], activeProject: null })
      return null
    }
  }, [])

  /** Apply a server state response and reload artifacts when the active changes. */
  const applyState = React.useCallback(
    async (state: WorkspaceState) => {
      const activeChanged = state.active?.path !== workspace?.path
      setWorkspace(state.active)
      setWorkspaces(state.workspaces)
      if (activeChanged) {
        if (state.active) {
          const project = await loadProjects()
          await loadArtifacts(project?.id ?? null)
        } else {
          activeProjectRef.current = null
          setProjectsState({ projects: [], invalid: [], activeProject: null })
          setArtifacts([])
        }
      }
    },
    [workspace?.path, loadArtifacts, loadProjects]
  )

  const bootstrap = React.useCallback(async () => {
    setLoading(true)
    try {
      const state = await apiFetch<WorkspaceState>("/api/workspace")
      setWorkspace(state.active)
      setWorkspaces(state.workspaces)
      if (state.active) {
        const project = await loadProjects()
        await loadArtifacts(project?.id ?? null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace")
    } finally {
      setLoading(false)
    }
  }, [loadArtifacts, loadProjects])

  const setActiveProject = React.useCallback(
    async (id: string | null) => {
      try {
        await apiFetch<{ activeProject: string | null }>("/api/projects/active", {
          method: "PUT",
          body: JSON.stringify({ id }),
        })
        const project = await loadProjects()
        await loadArtifacts(project?.id ?? null)
        toast.success(project ? `Opened project ${project.name}` : "Showing the whole workspace")
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not switch project")
        return false
      }
    },
    [loadArtifacts, loadProjects]
  )

  const refreshProjects = React.useCallback(async () => {
    const before = activeProjectRef.current
    const project = await loadProjects()
    if ((project?.id ?? null) !== before) await loadArtifacts(project?.id ?? null)
  }, [loadArtifacts, loadProjects])

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

  const createWorkspace = React.useCallback(
    async (path: string, template: WorkspaceTemplate = "blank") => {
      try {
        const state = await apiFetch<WorkspaceState>("/api/workspace", {
          method: "POST",
          body: JSON.stringify({ path, create: true, template }),
        })
        await applyState(state)
        toast.success(`Created workspace "${state.active?.name ?? "workspace"}"`)
        return true
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create workspace"
        )
        return false
      }
    },
    [applyState]
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

  const refresh = React.useCallback(() => loadArtifacts(), [loadArtifacts])

  const project =
    projectsState.projects.find((p) => p.id === projectsState.activeProject) ?? null

  const scoped = React.useCallback(
    (url: string) => withScope(url, projectsState.activeProject),
    [projectsState.activeProject]
  )

  const value: WorkspaceContextValue = {
    workspace,
    workspaces,
    artifacts,
    loading,
    loadingArtifacts,
    error,
    addWorkspace,
    createWorkspace,
    setActive,
    removeWorkspace,
    refresh,
    byType,
    projects: projectsState.projects,
    invalidProjects: projectsState.invalid,
    project,
    setActiveProject,
    refreshProjects,
    scoped,
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
