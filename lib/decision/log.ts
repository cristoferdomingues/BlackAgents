import { promises as fs } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { configDir } from "@/lib/config"

import { decisionLogEntrySchema, type DecisionLogEntry } from "./cutoffs"

/** Oldest entries drop off first once the log holds this many. */
export const DECISION_LOG_MAX = 200

const fileSchema = z.object({ entries: z.array(z.unknown()) })

export function decisionLogFile(): string {
  return path.join(configDir(), "jev-decisions.json")
}

/** Oldest first. A missing or broken file reads as empty; broken rows are dropped. */
export async function readDecisionLog(): Promise<DecisionLogEntry[]> {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(await fs.readFile(decisionLogFile(), "utf8")) as unknown)
    if (!parsed.success) return []
    return parsed.data.entries.flatMap((raw) => {
      const entry = decisionLogEntrySchema.safeParse(raw)
      return entry.success ? [entry.data] : []
    })
  } catch {
    return []
  }
}

async function writeLog(entries: DecisionLogEntry[]): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true })
  const file = decisionLogFile()
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8")
  await fs.rename(temp, file)
}

let queue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => undefined)
  return queue
}

/** Add one entry. Never throws; a failed write only loses this entry. */
export function appendDecision(entry: DecisionLogEntry): Promise<void> {
  return enqueue(async () => {
    const entries = [...(await readDecisionLog()), entry]
    await writeLog(entries.slice(-DECISION_LOG_MAX))
  })
}

/** Empty the log. Unlike `appendDecision`, a failed write rejects. */
export async function clearDecisionLog(): Promise<void> {
  const run = queue.then(() => writeLog([]))
  queue = run.catch(() => undefined)
  await run
}
