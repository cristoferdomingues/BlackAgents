import { pathExists, readText, resolveInWorkspace, writeText } from "@/lib/fs-service"
import { ensureLocalStateIgnored } from "@/lib/workflows/store"

import { K0dingError } from "./errors"
import { projectNotesSchema } from "./schema"
import { K0DING_DIR } from "./store"

function notesRel(rootId: string, scope?: string): string {
  return scope ? `${K0DING_DIR}/${scope}/${rootId}/notes.md` : `${K0DING_DIR}/${rootId}/notes.md`
}

export async function readProjectNotes(workspace: string, scope: string | undefined, rootId: string): Promise<string> {
  const abs = resolveInWorkspace(workspace, notesRel(rootId, scope))
  return (await pathExists(abs)) ? readText(abs) : ""
}

export async function saveProjectNotes(
  workspace: string,
  scope: string | undefined,
  rootId: string,
  body: unknown
): Promise<string> {
  const parsed = projectNotesSchema.safeParse(body)
  if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Invalid notes")
  await ensureLocalStateIgnored(workspace)
  await writeText(resolveInWorkspace(workspace, notesRel(rootId, scope)), parsed.data.content)
  return parsed.data.content
}
