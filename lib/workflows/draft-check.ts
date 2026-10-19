import { expandBuiltinTools, FILE_WRITE_TOOLS } from "@/lib/runtime/tool-names"
import type { Workflow } from "@/lib/workflows/schema"
import { abilityLabel, agentBuiltinTools } from "@/lib/workflows/step-explain"

/**
 * Checks a drafted workflow for steps that cannot do the job their
 * instructions describe. Isomorphic: the Assistant draft card shows these.
 */

export interface DraftAgent {
  name: string
  frontmatter?: Record<string, unknown>
}

export interface DraftStepCheck {
  stepId: string
  /** The step's ability, e.g. "Read only", or null when the agent is missing. */
  ability: string | null
  warnings: string[]
}

const CHANGE_WORDS =
  /\b(implement|build|create|add|write|fix|repair|refactor|update|change|edit|generate|scaffold)\b/i
const COMMAND_WORDS =
  /\b(run|re-run|rerun)\b[^.]*\b(tests?|build|lint|type-check|command)\b|\b(npm|npx|pnpm|yarn|vitest|playwright)\b/i

function agentMcpServers(frontmatter: Record<string, unknown> | undefined): string[] | undefined {
  const raw = frontmatter?.mcpServers
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : undefined
}

export function checkWorkflowDraft(workflow: Workflow, agents: readonly DraftAgent[]): DraftStepCheck[] {
  return workflow.steps.map((step) => {
    const agent = agents.find((a) => a.name === step.agent)
    if (!agent) return { stepId: step.id, ability: null, warnings: [] }

    const tools = step.tools ?? agentBuiltinTools(agent.frontmatter)
    const expanded = expandBuiltinTools(tools)
    const canWrite = expanded.some((name) => FILE_WRITE_TOOLS.includes(name))
    const canRun = expanded.includes("shell_run")
    const instructions = step.instructions
    const wantsChange = !step.review && (step.repair || CHANGE_WORDS.test(instructions))
    const servers = step.mcpServers ?? agentMcpServers(agent.frontmatter)

    const warnings: string[] = []
    if (wantsChange && !canWrite) {
      warnings.push("It can only read files, but its instructions ask it to change them. Give it Read and write.")
    }
    if (COMMAND_WORDS.test(instructions) && !canRun) {
      warnings.push("It cannot run commands, but its instructions ask it to run tests or commands. Give it Full.")
    }
    if (canWrite && !step.allowWrites) {
      warnings.push("Every file change will wait for your approval.")
    }
    if (servers === undefined && step.allowWrites) {
      warnings.push("It can use every MCP server, and their changes run without asking. Pick servers or None.")
    }
    return { stepId: step.id, ability: abilityLabel(tools), warnings }
  })
}

/** A message the user can send so the Assistant fixes the flagged steps. */
export function draftFixRequest(workflowName: string, checks: readonly DraftStepCheck[]): string | null {
  const lines = checks
    .filter((c) => c.warnings.length > 0)
    .map((c) => `- ${c.stepId}: ${c.warnings.join(" ")}`)
  if (lines.length === 0) return null
  return [
    `Fix the tools in the "${workflowName}" workflow draft. Set tools, mcpServers, and allowWrites on each step to match its job:`,
    ...lines,
  ].join("\n")
}
