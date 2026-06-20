import {
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  workspaceRoot,
  writeText,
} from "../fs-service"
import { DEFAULT_STANDARDS_MD } from "./default-standards"

/** Per-workspace override location for the authoring standards. */
const STANDARDS_REL_PATH = ".black-agents/standards.md"

export interface StandardsDoc {
  content: string
  /** True when the workspace has its own standards file (vs the baked default). */
  custom: boolean
}

export async function loadStandards(): Promise<StandardsDoc> {
  const root = await workspaceRoot()
  const abs = resolveInWorkspace(root, STANDARDS_REL_PATH)
  if (await pathExists(abs)) {
    return { content: await readText(abs), custom: true }
  }
  return { content: DEFAULT_STANDARDS_MD, custom: false }
}

export async function saveStandards(content: string): Promise<StandardsDoc> {
  const root = await workspaceRoot()
  const abs = resolveInWorkspace(root, STANDARDS_REL_PATH)
  await writeText(abs, content.trimEnd() + "\n")
  return { content, custom: true }
}

/** Reset to the baked default by removing the per-workspace override. */
export async function resetStandards(): Promise<StandardsDoc> {
  const root = await workspaceRoot()
  const abs = resolveInWorkspace(root, STANDARDS_REL_PATH)
  await removePath(abs)
  return { content: DEFAULT_STANDARDS_MD, custom: false }
}
