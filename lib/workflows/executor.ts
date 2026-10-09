import { composeArtifactPrompt, linkedArtifacts } from "@/lib/assistant/turn-artifacts"
import type { Artifact } from "@/lib/artifacts/types"
import type { ResolvedDecisionClient } from "@/lib/decision/client"
import { evaluateStepGate, STEP_GATE_MIN_CONFIDENCE } from "@/lib/decision/classify-workflow"
import { buildAgentPersonaContext } from "@/lib/llm/context"
import { markInvalidOnAuthFailure } from "@/lib/llm/credentials"
import { ProviderError } from "@/lib/llm/types"
import { createApprovalPolicy } from "@/lib/runtime/approval-policy"
import { runAgentLoop } from "@/lib/runtime/agent-loop"
import { createRegistryApprover } from "@/lib/runtime/ask-user"
import { agentToolScope, type ToolScope } from "@/lib/runtime/tools"
import type { RuntimeTool } from "@/lib/runtime/types"

import { buildStepMessage, filesChangedBy, handoffsFor } from "./handoff"
import type { ResolvedLlm } from "./llm"
import type { StepGateResult, StepRun, Workflow, WorkflowRun } from "./schema"

export const REPORT_MAX_CHARS = 2_000

/** Everything the executor reads from the outside world, injectable for tests. */
export interface ExecutorDeps {
  artifacts: (root: string) => Promise<Artifact[]>
  resolveLlm: (workflow: Workflow) => Promise<ResolvedLlm>
  buildTools: (root: string, scope: ToolScope) => Promise<RuntimeTool[]>
  decision: () => Promise<ResolvedDecisionClient | null>
  brainContext: (params: {
    workspaceRoot: string
    agent: string
    task: string
    resolved: ResolvedDecisionClient | null
  }) => Promise<string>
  save: (run: WorkflowRun) => Promise<void>
  emit: (run: WorkflowRun) => void
  runLoop?: typeof runAgentLoop
}

export function newRun(params: {
  id: string
  workflow: Workflow
  workspaceRoot: string
  trigger: WorkflowRun["trigger"]
  task: string
  now?: Date
}): WorkflowRun {
  return {
    id: params.id,
    workflow: params.workflow.name,
    workspaceRoot: params.workspaceRoot,
    status: "queued",
    trigger: params.trigger,
    task: params.task,
    createdAt: (params.now ?? new Date()).toISOString(),
    steps: params.workflow.steps.map((s) => ({
      id: s.id,
      agent: s.agent,
      status: "pending",
      attempts: 0,
      toolExecutions: [],
      filesChanged: [],
    })),
    pendingApproval: null,
  }
}

function clipReport(text: string): string {
  return text.length > REPORT_MAX_CHARS ? `${text.slice(0, REPORT_MAX_CHARS)}…` : text
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

class StepFailure extends Error {}

/**
 * Run a workflow's steps in order. Each step is one agent loop; its reply is
 * handed to the next step as untrusted data. The run object is mutated,
 * saved and emitted on every state change. Never throws.
 */
export async function executeRun(
  run: WorkflowRun,
  workflow: Workflow,
  deps: ExecutorDeps,
  cancelSignal: AbortSignal
): Promise<WorkflowRun> {
  const loop = deps.runLoop ?? runAgentLoop
  const runSignal = AbortSignal.any([
    cancelSignal,
    AbortSignal.timeout(workflow.limits.runTimeoutMinutes * 60_000),
  ])
  const policy = createApprovalPolicy(false)

  const update = async (): Promise<void> => {
    await deps.save(run)
    deps.emit(run)
  }
  const finish = async (status: WorkflowRun["status"], fields: Partial<WorkflowRun>): Promise<WorkflowRun> => {
    run.status = status
    run.finishedAt = new Date().toISOString()
    run.pendingApproval = null
    Object.assign(run, fields)
    for (const step of run.steps) {
      if (step.status === "pending" || step.status === "running" || step.status === "waiting_approval") {
        step.status = step.status === "pending" ? "skipped" : "failed"
        step.finishedAt ??= run.finishedAt
      }
    }
    await update()
    return run
  }

  run.status = "running"
  run.startedAt = new Date().toISOString()
  await update()

  try {
    const [llm, all, resolved] = await Promise.all([
      deps.resolveLlm(workflow),
      deps.artifacts(run.workspaceRoot),
      deps.decision(),
    ])

    for (const [index, step] of workflow.steps.entries()) {
      const stepRun = run.steps[index]
      const agent = all.find((a) => a.type === "agent" && a.name === step.agent)
      if (!agent) throw new StepFailure(`Agent "${step.agent}" was not found`)

      const own = agentToolScope(agent)
      const tools = await deps.buildTools(run.workspaceRoot, {
        builtins: step.tools ?? own.builtins,
        mcpServers: step.mcpServers ?? own.mcpServers,
      })
      const sections = [buildAgentPersonaContext(agent)]
      const linked = composeArtifactPrompt(linkedArtifacts([agent], all).slice(0, 5))
      if (linked) sections.push(linked)
      const brain = await deps.brainContext({
        workspaceRoot: run.workspaceRoot,
        agent: agent.name,
        task: run.task,
        resolved,
      })
      if (brain) sections.push(brain)
      policy.allowWrites = step.allowWrites
      policy.allowFileWrites = false

      let retryNote: string | undefined
      let gate: StepGateResult | undefined
      for (;;) {
        stepRun.attempts++
        stepRun.status = "running"
        stepRun.startedAt = new Date().toISOString()
        stepRun.error = undefined
        await update()

        const stepSignal = AbortSignal.any([
          runSignal,
          AbortSignal.timeout(workflow.limits.stepTimeoutMinutes * 60_000),
        ])
        const approve = createRegistryApprover({
          scope: { kind: "run", runId: run.id, stepId: step.id, workflow: workflow.name },
          signal: stepSignal,
          onRequest: async (request) => {
            run.status = "waiting_approval"
            stepRun.status = "waiting_approval"
            run.pendingApproval = request
            await update()
          },
          onResolved: async () => {
            run.status = "running"
            stepRun.status = "running"
            run.pendingApproval = null
            await update()
          },
        })

        let content: string
        try {
          const result = await loop({
            provider: llm.provider,
            credentials: llm.credentials,
            model: llm.model,
            messages: [
              {
                role: "user",
                content: buildStepMessage({
                  workflow,
                  step,
                  index,
                  task: run.task,
                  handoffs: handoffsFor(step, run.steps.slice(0, index)),
                  retryNote,
                }),
              },
            ],
            systemContext: sections.join("\n\n"),
            tools,
            maxTurns: step.maxTurns,
            workspaceRoot: run.workspaceRoot,
            policy,
            approve,
            signal: stepSignal,
          })
          content = result.content
          stepRun.toolExecutions.push(...result.toolExecutions)
        } catch (err) {
          if (cancelSignal.aborted) throw err
          if (err instanceof ProviderError) await markInvalidOnAuthFailure(llm.provider, err, llm.secret)
          const reason = runSignal.aborted
            ? "The run took longer than its time limit"
            : stepSignal.aborted
              ? "The step took longer than its time limit"
              : errorText(err)
          stepRun.status = "failed"
          stepRun.error = reason
          stepRun.finishedAt = new Date().toISOString()
          throw new StepFailure(`Step "${step.id}" failed: ${reason}`)
        }

        stepRun.output = content
        stepRun.filesChanged = filesChangedBy(stepRun.toolExecutions)
        gate = step.gate
          ? await decideGate({ resolved, workflow, run, step: stepRun, instructions: step.instructions, isLast: index === workflow.steps.length - 1 })
          : undefined
        stepRun.gate = gate
        if (gate?.decision === "retry" && stepRun.attempts <= workflow.limits.maxRetries) {
          retryNote = "A reviewer judged your last answer incomplete or off-task. Try again and finish the job."
          continue
        }
        break
      }

      stepRun.status = "succeeded"
      stepRun.finishedAt = new Date().toISOString()
      await update()

      if (gate?.decision === "stop") {
        return await finish("succeeded", {
          report: clipReport(`Stopped early after "${step.id}".\n\n${stepRun.output ?? ""}`),
        })
      }
    }

    const last = run.steps[run.steps.length - 1]
    return await finish("succeeded", { report: clipReport(last.output ?? "") })
  } catch (err) {
    if (cancelSignal.aborted) return finish("cancelled", { error: "Cancelled by the user" })
    return finish("failed", { error: errorText(err) })
  }
}

async function decideGate(params: {
  resolved: ResolvedDecisionClient | null
  workflow: Workflow
  run: WorkflowRun
  step: StepRun
  instructions: string
  isLast: boolean
}): Promise<StepGateResult> {
  const decision = await evaluateStepGate({
    resolved: params.resolved,
    workflow: params.workflow.name,
    task: params.run.task,
    stepId: params.step.id,
    agent: params.step.agent,
    instructions: params.instructions,
    output: params.step.output ?? "",
    isLastStep: params.isLast,
  })
  if (decision.kind === "decided" && decision.confidence >= STEP_GATE_MIN_CONFIDENCE) {
    return { decision: decision.label, by: "jev", confidence: decision.confidence }
  }
  return { decision: "continue", by: "default" }
}
