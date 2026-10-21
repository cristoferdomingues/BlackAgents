import { loadProjectScope } from "@/lib/artifacts/projects"
import { readConfig } from "@/lib/config"

import { K0dingError } from "./errors"

export interface K0dingWorkspace {
  workspace: string
  scope?: string
}

/** The active workspace, plus the active project id when that project is valid. */
export async function k0dingWorkspace(): Promise<K0dingWorkspace> {
  const config = await readConfig()
  if (!config.currentPath) throw new K0dingError("No workspace selected", 412)
  if (!config.activeProject) return { workspace: config.currentPath }
  const loaded = await loadProjectScope(config.currentPath, config.activeProject)
  return loaded.ok
    ? { workspace: config.currentPath, scope: loaded.project.id }
    : { workspace: config.currentPath }
}
