import type { ToolExecutionTrace } from "@/lib/mcp/types"

import { flowStepsFromTraces } from "./flows/from-traces"
import type { BrowserFlowStep } from "./flows/schema"

export interface BrowserRecordingSession {
  workspaceRoot: string
  startedAt: string
  steps: BrowserFlowStep[]
}

const sessions = new Map<string, BrowserRecordingSession>()

export function getRecording(workspaceRoot: string): BrowserRecordingSession | null {
  return sessions.get(workspaceRoot) ?? null
}

export function startRecording(workspaceRoot: string): BrowserRecordingSession {
  const session: BrowserRecordingSession = {
    workspaceRoot,
    startedAt: new Date().toISOString(),
    steps: [],
  }
  sessions.set(workspaceRoot, session)
  return session
}

export function stopRecording(workspaceRoot: string): BrowserRecordingSession | null {
  const session = sessions.get(workspaceRoot) ?? null
  sessions.delete(workspaceRoot)
  return session
}

export function appendRecordingSteps(
  workspaceRoot: string,
  steps: Array<Omit<BrowserFlowStep, "id" | "kind" | "args"> & {
    id?: string
    kind?: BrowserFlowStep["kind"]
    args?: Record<string, unknown>
    tool: string
  }>
): BrowserRecordingSession | null {
  const session = sessions.get(workspaceRoot)
  if (!session) return null
  for (const step of steps) {
    session.steps.push({
      ...step,
      args: step.args ?? {},
      kind: step.kind ?? "action",
      id: `step_${session.steps.length + 1}`,
    })
  }
  return session
}

/** If a recording is active for this workspace, append successful browser traces. */
export function maybeRecordBrowserTraces(
  workspaceRoot: string,
  traces: ToolExecutionTrace[]
): void {
  if (!sessions.has(workspaceRoot)) return
  const steps = flowStepsFromTraces(traces)
  if (steps.length === 0) return
  appendRecordingSteps(workspaceRoot, steps)
}
