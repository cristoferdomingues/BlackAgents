import { findArtifact } from "@/lib/artifacts/parser"
import type { ArtifactInput } from "@/lib/artifacts/schemas"
import { sourceRelPath } from "@/lib/artifacts/source"
import { createArtifact, updateArtifact } from "@/lib/artifacts/store"
import { saveWorkflow } from "@/lib/workflows/store"
import { workflowSchema, type Workflow } from "@/lib/workflows/schema"

import { BROWSER_MCP_SERVER } from "./constants"
import type { BrowserFlow } from "./flows/schema"

function skillBody(flow: BrowserFlow): string {
  const stepLines = flow.steps
    .map((s, i) => `${i + 1}. \`${s.tool}\` ${JSON.stringify(s.args)}${s.note ? ` — ${s.note}` : ""}`)
    .join("\n")

  return `Use this skill to replay the saved browser flow **${flow.name}**.

## When to use

${flow.description || `Run the "${flow.name}" browser automation.`}

## How to run

1. Confirm the BlackAgents **desktop** app is running (browser tools are Electron-only).
2. Prefer the builtin tool \`browser_run_flow\` with \`{ "name": "${flow.name}" }\`.
3. If that tool is unavailable, call MCP server \`${BROWSER_MCP_SERVER}\` tools in order:
${stepLines || "(no steps yet)"}

## Auth / session

- Profile: \`${flow.profile}\` (persistent Chromium user data under \`~/.black-agents/browser-profiles/\`).
- If login fails or the site asks for 2FA, stop and tell the user to re-login via **Settings → Browser**.
${flow.startUrl ? `\n## Start URL\n\n${flow.startUrl}\n` : ""}
`
}

function agentBody(flow: BrowserFlow): string {
  return `You automate browser tasks using the Playwright MCP server \`${BROWSER_MCP_SERVER}\` and saved flows.

## Primary flow

Replay **${flow.name}** with \`browser_run_flow\` when the user asks to run this automation (or on a scheduled workflow).

## Rules

- Never invent credentials. If the session expired, stop and ask for a re-login.
- Prefer the saved flow over ad-hoc clicking unless the user is coaching a new path.
- After a successful coached session, suggest saving a new flow.
`
}

/**
 * Write a Cursor skill + agent that bind to a saved browser flow.
 * Does not overwrite existing files unless `overwrite` is true.
 */
/** Create the artifact, or replace it only when `overwrite` is set. */
async function saveIfAllowed(root: string, input: ArtifactInput, overwrite: boolean): Promise<boolean> {
  const existing = await findArtifact(root, input.type, input.name)
  if (existing && !overwrite) return false
  if (existing) await updateArtifact(root, input.name, input)
  else await createArtifact(root, input)
  return true
}

export async function bindFlowArtifacts(
  workspaceRoot: string,
  flow: BrowserFlow,
  options?: { overwrite?: boolean; agentName?: string; skillName?: string }
): Promise<{ agentPath: string; skillPath: string; created: string[] }> {
  const agentName = options?.agentName ?? `${flow.name}-agent`
  const skillName = options?.skillName ?? flow.name
  const overwrite = options?.overwrite ?? false
  const created: string[] = []

  const skillInput: ArtifactInput = {
    type: "skill",
    platform: "cursor",
    name: skillName,
    description: flow.description || `Browser flow: ${flow.name}`,
    body: skillBody(flow),
    extra: {},
  }
  const skillRel = sourceRelPath("skill", skillName)
  if (await saveIfAllowed(workspaceRoot, skillInput, overwrite)) created.push(skillRel)

  const agentInput: ArtifactInput = {
    type: "agent",
    platform: "cursor",
    name: agentName,
    description: `Runs browser flow ${flow.name}`,
    body: agentBody(flow),
    extra: {
      tools: ["fs_read", "fs_list", "browser_run_flow"],
      mcpServers: [BROWSER_MCP_SERVER],
    },
  }
  const agentRel = sourceRelPath("agent", agentName)
  if (await saveIfAllowed(workspaceRoot, agentInput, overwrite)) created.push(agentRel)

  return { agentPath: agentRel, skillPath: skillRel, created }
}

/** Create a daily workflow that runs the time-registrar-style agent. */
export async function saveDailyBrowserWorkflow(
  workspaceRoot: string,
  input: {
    workflowName: string
    agentName: string
    flowName: string
    at: string
    task: string
    description?: string
  }
): Promise<Workflow> {
  const workflow: Workflow = workflowSchema.parse({
    name: input.workflowName,
    description: input.description ?? `Daily browser automation for ${input.flowName}`,
    task: input.task,
    trigger: { type: "daily", at: input.at },
    steps: [
      {
        id: "run-flow",
        agent: input.agentName,
        instructions: `Run the saved browser flow "${input.flowName}" using browser_run_flow. If authentication fails, stop and report that the user must re-login in Settings → Browser.`,
        input: "task",
        mcpServers: [BROWSER_MCP_SERVER],
        tools: ["fs_read", "fs_list", "browser_run_flow"],
        allowWrites: false,
        maxTurns: 8,
        gate: false,
      },
    ],
    limits: {
      stepTimeoutMinutes: 15,
      runTimeoutMinutes: 30,
      maxRetries: 0,
    },
    selfAssess: false,
  })
  await saveWorkflow(workspaceRoot, workflow)
  return workflow
}
