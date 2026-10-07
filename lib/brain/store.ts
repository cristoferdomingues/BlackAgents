import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { nameSchema } from "@/lib/artifacts/schemas"
import { listDir, pathExists, readText, resolveInWorkspace, writeText } from "@/lib/fs-service"
import { ensureLocalStateIgnored } from "@/lib/workflows/store"

import { LEARNING_ACTIONS, type BrainNote, type BrainProposal } from "./types"

/**
 * Brain files inside the workspace:
 * - `.black-agents/brain/inbox/<id>.json` — proposals (local, git-ignored)
 * - `.black-agents/brain/agents/<agent>.md` — each agent's approved notes
 * - `.black-agents/brain/workspace.md` — shared notes
 * - `.black-agents/brain/log.jsonl` — every applied change
 */

export const BRAIN_DIR = ".black-agents/brain"
export const BRAIN_FILE_MAX_CHARS = 8_000
const NOTE_MAX_CHARS = 500
const NOTE_LINE_RE = /^- \[(\d{4}-\d{2}-\d{2})\] (.+)$/

const proposalFileSchema = z
  .object({
    id: z.string(),
    kind: z.enum(LEARNING_ACTIONS).exclude(["nothing"]),
    title: z.string(),
    content: z.string(),
    status: z.enum(["pending", "approved", "rejected"]),
    createdAt: z.string(),
  })
  .passthrough()

function isProposal(value: unknown): value is BrainProposal {
  return proposalFileSchema.safeParse(value).success
}

function inboxPath(root: string, id: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid proposal id")
  return resolveInWorkspace(root, `${BRAIN_DIR}/inbox/${id}.json`)
}

function brainPath(root: string, agent?: string): string {
  if (agent === undefined) return resolveInWorkspace(root, `${BRAIN_DIR}/workspace.md`)
  if (!nameSchema.safeParse(agent).success) throw new Error("Invalid agent name")
  return resolveInWorkspace(root, `${BRAIN_DIR}/agents/${agent}.md`)
}

export async function saveProposal(root: string, proposal: BrainProposal): Promise<void> {
  await ensureLocalStateIgnored(root)
  await writeText(inboxPath(root, proposal.id), JSON.stringify(proposal, null, 2))
}

export async function readProposal(root: string, id: string): Promise<BrainProposal | null> {
  try {
    const abs = inboxPath(root, id)
    if (!(await pathExists(abs))) return null
    const value: unknown = JSON.parse(await readText(abs))
    return isProposal(value) ? value : null
  } catch {
    return null
  }
}

/** Newest first. */
export async function listProposals(root: string): Promise<BrainProposal[]> {
  const out: BrainProposal[] = []
  for (const entry of await listDir(resolveInWorkspace(root, `${BRAIN_DIR}/inbox`))) {
    if (entry.isDirectory || !entry.name.endsWith(".json")) continue
    const proposal = await readProposal(root, entry.name.slice(0, -5))
    if (proposal) out.push(proposal)
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function formatNoteText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > NOTE_MAX_CHARS ? `${flat.slice(0, NOTE_MAX_CHARS)}…` : flat
}

export async function readNotes(root: string, agent?: string): Promise<BrainNote[]> {
  const abs = brainPath(root, agent)
  if (!(await pathExists(abs))) return []
  const notes: BrainNote[] = []
  for (const line of (await readText(abs)).split("\n")) {
    const m = line.match(NOTE_LINE_RE)
    if (m) notes.push({ date: m[1], text: m[2] })
  }
  return notes
}

function renderBrain(agent: string | undefined, notes: BrainNote[]): string {
  const title = agent ? `# Brain: ${agent}` : "# Workspace brain"
  const lines = notes.map((n) => `- [${n.date}] ${n.text}`)
  return `${title}\n\nApproved memory notes. Edit freely; one note per line.\n\n${lines.join("\n")}\n`
}

/** Add a note; the oldest notes drop off when the file passes its size cap. */
export async function appendNote(
  root: string,
  agent: string | undefined,
  text: string,
  now = new Date()
): Promise<BrainNote> {
  const note = { date: now.toISOString().slice(0, 10), text: formatNoteText(text) }
  const notes = [...(await readNotes(root, agent)), note]
  while (notes.length > 1 && renderBrain(agent, notes).length > BRAIN_FILE_MAX_CHARS) notes.shift()
  await writeText(brainPath(root, agent), renderBrain(agent, notes))
  return note
}

export async function listAgentBrains(root: string): Promise<Array<{ name: string; notes: BrainNote[] }>> {
  const out: Array<{ name: string; notes: BrainNote[] }> = []
  for (const entry of await listDir(resolveInWorkspace(root, `${BRAIN_DIR}/agents`))) {
    if (entry.isDirectory || !entry.name.endsWith(".md")) continue
    const name = entry.name.slice(0, -3)
    if (!nameSchema.safeParse(name).success) continue
    out.push({ name, notes: await readNotes(root, name) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export interface BrainLogEntry {
  at: string
  event: "proposed" | "applied" | "rejected" | "recorded"
  proposalId?: string
  kind?: string
  agent?: string
  target?: string
  reason?: string
}

export async function appendLog(root: string, entry: BrainLogEntry): Promise<void> {
  const abs = resolveInWorkspace(root, `${BRAIN_DIR}/log.jsonl`)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.appendFile(abs, `${JSON.stringify(entry)}\n`, "utf8")
}
