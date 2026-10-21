import { randomUUID } from "node:crypto"

import { projectIdSchema } from "@/lib/artifacts/schemas"
import { pathExists, readText, resolveInWorkspace, walkFiles, writeText } from "@/lib/fs-service"
import { ensureLocalStateIgnored } from "@/lib/workflows/store"

import { K0dingError } from "./errors"
import { K0DING_DIR } from "./store"
import { codingSessionSchema, type CodingModel, type CodingSession } from "./schema"

function sessionsDir(scope?: string): string {
  if (scope && !projectIdSchema.safeParse(scope).success) throw new K0dingError("Invalid project")
  return scope ? `${K0DING_DIR}/${scope}/sessions` : `${K0DING_DIR}/sessions`
}

function sessionRel(id: string, scope?: string): string {
  if (!codingSessionSchema.shape.id.safeParse(id).success) throw new K0dingError("Invalid session id")
  return `${sessionsDir(scope)}/${id}.json`
}

export async function createCodingSession(input: {
  workspace: string
  scope?: string
  rootId: string
  context: string[]
  model: CodingModel
  messages: CodingSession["messages"]
}): Promise<CodingSession> {
  const session = codingSessionSchema.parse({
    id: randomUUID(),
    rootId: input.rootId,
    createdAt: new Date().toISOString(),
    status: "running",
    context: input.context,
    model: input.model,
    messages: input.messages,
    changes: [],
  })
  await saveCodingSession(input.workspace, input.scope, session)
  return session
}

export async function saveCodingSession(
  workspace: string,
  scope: string | undefined,
  session: CodingSession
): Promise<CodingSession> {
  const parsed = codingSessionSchema.safeParse(session)
  if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Invalid session")
  await ensureLocalStateIgnored(workspace)
  await writeText(resolveInWorkspace(workspace, sessionRel(parsed.data.id, scope)), `${JSON.stringify(parsed.data, null, 2)}\n`)
  return parsed.data
}

async function findSessionFile(workspace: string, id: string): Promise<string | null> {
  if (!codingSessionSchema.shape.id.safeParse(id).success) throw new K0dingError("Invalid session id")
  const dir = resolveInWorkspace(workspace, K0DING_DIR)
  if (!(await pathExists(dir))) return null
  const name = `${id}.json`
  for (const rel of await walkFiles(dir)) {
    const normalized = rel.split(/[/\\]/).join("/")
    if (normalized.endsWith(`/sessions/${name}`) || normalized === `sessions/${name}`) {
      return resolveInWorkspace(workspace, `${K0DING_DIR}/${normalized}`)
    }
  }
  return null
}

export async function readCodingSession(workspace: string, id: string): Promise<CodingSession | null> {
  const abs = await findSessionFile(workspace, id)
  if (!abs) return null
  const parsed = codingSessionSchema.safeParse(JSON.parse(await readText(abs)) as unknown)
  if (!parsed.success) throw new K0dingError("This coding session is damaged")
  return parsed.data
}

export async function latestCodingSession(
  workspace: string,
  scope: string | undefined,
  rootId: string
): Promise<CodingSession | null> {
  const dir = resolveInWorkspace(workspace, sessionsDir(scope))
  if (!(await pathExists(dir))) return null
  let latest: CodingSession | null = null
  for (const rel of await walkFiles(dir)) {
    if (!rel.endsWith(".json")) continue
    try {
      const parsed = codingSessionSchema.safeParse(
        JSON.parse(await readText(resolveInWorkspace(workspace, `${sessionsDir(scope)}/${rel}`))) as unknown
      )
      if (!parsed.success || parsed.data.rootId !== rootId) continue
      if (!latest || parsed.data.createdAt > latest.createdAt) latest = parsed.data
    } catch {
      // Skip a file that is not a session.
    }
  }
  return latest
}
