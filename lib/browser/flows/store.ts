import {
  listDir,
  pathExists,
  readText,
  removePath,
  resolveInWorkspace,
  writeText,
} from "@/lib/fs-service"

import { BROWSER_FLOWS_DIR } from "../constants"
import { promoteFlowSecrets } from "../secrets"
import {
  browserFlowInputSchema,
  browserFlowSchema,
  type BrowserFlow,
  type BrowserFlowInput,
} from "./schema"

function flowRelPath(name: string): string {
  return `${BROWSER_FLOWS_DIR}/${name}.json`
}

export async function listBrowserFlows(workspaceRoot: string): Promise<BrowserFlow[]> {
  const dir = resolveInWorkspace(workspaceRoot, BROWSER_FLOWS_DIR)
  if (!(await pathExists(dir))) return []

  const entries = await listDir(dir)
  const flows: BrowserFlow[] = []
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(".json")) continue
    const abs = resolveInWorkspace(workspaceRoot, `${BROWSER_FLOWS_DIR}/${entry.name}`)
    try {
      const parsed = browserFlowSchema.safeParse(JSON.parse(await readText(abs)) as unknown)
      if (parsed.success) flows.push(parsed.data)
    } catch {
      // skip corrupt
    }
  }
  return flows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readBrowserFlow(
  workspaceRoot: string,
  name: string
): Promise<BrowserFlow | null> {
  const abs = resolveInWorkspace(workspaceRoot, flowRelPath(name))
  if (!(await pathExists(abs))) return null
  try {
    const parsed = browserFlowSchema.safeParse(JSON.parse(await readText(abs)) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function saveBrowserFlow(
  workspaceRoot: string,
  input: BrowserFlowInput
): Promise<BrowserFlow> {
  const parsed = browserFlowInputSchema.parse(input)
  const now = new Date().toISOString()
  const existing = await readBrowserFlow(workspaceRoot, parsed.name)
  const steps = await promoteFlowSecrets(parsed.name, parsed.steps)
  const flow: BrowserFlow = browserFlowSchema.parse({
    name: parsed.name,
    description: parsed.description ?? existing?.description ?? "",
    version: 2,
    profile: parsed.profile ?? existing?.profile ?? "default",
    startUrl: parsed.startUrl ?? existing?.startUrl,
    autoAccept: parsed.autoAccept ?? existing?.autoAccept ?? false,
    steps,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  await writeText(
    resolveInWorkspace(workspaceRoot, flowRelPath(flow.name)),
    `${JSON.stringify(flow, null, 2)}\n`
  )
  return flow
}

/** Turn auto-accept on or off without rewriting the saved steps. */
export async function setBrowserFlowAutoAccept(
  workspaceRoot: string,
  name: string,
  autoAccept: boolean
): Promise<BrowserFlow | null> {
  const existing = await readBrowserFlow(workspaceRoot, name)
  if (!existing) return null
  const flow: BrowserFlow = browserFlowSchema.parse({
    ...existing,
    autoAccept,
    updatedAt: new Date().toISOString(),
  })
  await writeText(
    resolveInWorkspace(workspaceRoot, flowRelPath(flow.name)),
    `${JSON.stringify(flow, null, 2)}\n`
  )
  return flow
}

/** Saved flows the user marked as already tested. */
export async function loadAutoAcceptedFlows(workspaceRoot: string): Promise<{
  flowNames: string[]
  calls: Array<{ tool: string; args: Record<string, unknown> }>
}> {
  const flows = await listBrowserFlows(workspaceRoot)
  const flowNames: string[] = []
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  for (const flow of flows) {
    if (!flow.autoAccept) continue
    flowNames.push(flow.name)
    for (const step of flow.steps) {
      calls.push({ tool: step.tool, args: step.args })
    }
  }
  return { flowNames, calls }
}

export async function deleteBrowserFlow(
  workspaceRoot: string,
  name: string
): Promise<boolean> {
  const abs = resolveInWorkspace(workspaceRoot, flowRelPath(name))
  if (!(await pathExists(abs))) return false
  await removePath(abs)
  return true
}
