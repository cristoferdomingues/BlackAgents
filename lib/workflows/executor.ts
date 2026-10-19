import { composeArtifactPrompt, linkedArtifacts } from "@/lib/assistant/turn-artifacts"
import { withBuiltinArtifacts } from "@/lib/artifacts/builtin"
import type { Artifact } from "@/lib/artifacts/types"
import type { ResolvedDecisionClient } from "@/lib/decision/client"
import { evaluateStepGate, STEP_GATE_MIN_CONFIDENCE } from "@/lib/decision/classify-workflow"
import { looksLikeAuthFailure } from "@/lib/browser/classify"
import { parseFileMentions, resolveWorkspaceFiles, type WorkspaceFile } from "@/lib/files"
import { buildAgentPersonaContext, loadKnowledgeContext } from "@/lib/llm/context"
import { markInvalidOnAuthFailure } from "@/lib/llm/credentials"
import type { ModelLayer } from "@/lib/llm/model-ref"
import { ProviderError } from "@/lib/llm/types"
import { readAiSettings } from "@/lib/settings"
import { getBrowserSecrets } from "@/lib/secrets"
import { loadAutoAcceptedFlows } from "@/lib/browser"
import { createApprovalPolicy, preapprovedCallKey } from "@/lib/runtime/approval-policy"
import { runAgentLoop, truncateResult } from "@/lib/runtime/agent-loop"
import { createRegistryApprover } from "@/lib/runtime/ask-user"
import { browserFillLoginTool } from "@/lib/runtime/tools/browser-fill-login"
import { agentToolScope, type ToolScope } from "@/lib/runtime/tools"
import type { AgentLoopEvent, RuntimeTool, ToolExecutionTrace } from "@/lib/runtime/types"

import {
  appendAuditEvent,
  auditNow,
  llmRequestEvent,
  llmResponseEvent,
  toolCallEvent,
  type AuditEvent,
} from "./audit"
import { buildStepMessage, filesChangedBy, handoffsFor } from "./handoff"
import { alreadyLoggedInNote, loginSecretIds, loginStepNote } from "./login"
import { requestLogin, type LoginDecision } from "./login-wait"
import { stepModelLayers, stepResolveOptions, type ResolveLlmOptions, type ResolvedLlm } from "./llm"
import {
  applyLoopEventToStep,
  clearLiveStepFields,
  createThrottledUpdate,
} from "./live"
import { parseReviewVerdict, reviewReasons } from "./review"
import type { StepGateResult, StepRun, Workflow, WorkflowRun } from "./schema"

export const REPORT_MAX_CHARS = 2_000

/** Everything the executor reads from the outside world, injectable for tests. */
export interface ExecutorDeps {
  artifacts: (root: string) => Promise<Artifact[]>
  resolveLlm: (layers: ModelLayer[], options?: ResolveLlmOptions) => Promise<ResolvedLlm>
  buildTools: (root: string, scope: ToolScope) => Promise<RuntimeTool[]>
  decision: () => Promise<ResolvedDecisionClient | null>
  brainContext: (params: {
    workspaceRoot: string
    agent: string
    task: string
    resolved: ResolvedDecisionClient | null
  }) => Promise<string>
  resolveFiles?: (root: string, names: readonly string[]) => Promise<WorkspaceFile[]>
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
  stepFiles?: Record<string, string[]>
  now?: Date
}): WorkflowRun {
  return {
    id: params.id,
    workflow: params.workflow.name,
    workspaceRoot: params.workspaceRoot,
    status: "queued",
    trigger: params.trigger,
    task: params.task,
    ...(params.stepFiles && Object.keys(params.stepFiles).length > 0 ? { stepFiles: params.stepFiles } : {}),
    limits: { ...params.workflow.limits },
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
  const grants = await loadAutoAcceptedFlows(run.workspaceRoot)
  for (const name of grants.flowNames) policy.autoAcceptFlows.add(name)
  for (const call of grants.calls) {
    policy.autoAcceptedCalls.add(preapprovedCallKey(call.tool, call.args))
  }

  const update = async (): Promise<void> => {
    await deps.save(run)
    deps.emit(run)
  }
  const auditWrites: Promise<void>[] = []
  const audit = (event: AuditEvent): void => {
    auditWrites.push(appendAuditEvent(run.workspaceRoot, run.id, event))
  }
  const flushAudit = async (): Promise<void> => {
    await Promise.all(auditWrites.splice(0, auditWrites.length))
  }
  const finish = async (status: WorkflowRun["status"], fields: Partial<WorkflowRun>): Promise<WorkflowRun> => {
    run.status = status
    run.finishedAt = new Date().toISOString()
    run.pendingApproval = null
    run.pendingLogin = null
    Object.assign(run, fields)
    for (const step of run.steps) {
      if (
        step.status === "pending" ||
        step.status === "running" ||
        step.status === "waiting_approval" ||
        step.status === "waiting_login"
      ) {
        step.status = step.status === "pending" ? "skipped" : "failed"
        step.finishedAt ??= run.finishedAt
        clearLiveStepFields(step)
      }
    }
    await update()
    audit({
      type: "run_finished",
      ts: auditNow(),
      status: status === "succeeded" || status === "failed" || status === "cancelled" ? status : "failed",
      error: fields.error ?? run.error,
    })
    await flushAudit()
    return run
  }

  run.status = "running"
  run.startedAt = new Date().toISOString()
  await update()
  audit({
    type: "run_started",
    ts: auditNow(),
    workflow: run.workflow,
    task: run.task,
  })

  try {
    const [settings, workspaceArtifacts, resolved] = await Promise.all([
      readAiSettings(),
      deps.artifacts(run.workspaceRoot),
      deps.decision(),
    ])
    const all = withBuiltinArtifacts(workspaceArtifacts)
    const credentialCache = new Map<string, ResolvedLlm>()
    const knowledge = await loadKnowledgeContext(run.workspaceRoot)

    const reviewFeedback = new Map<string, string>()
    const sentBack = new Map<string, number>()
    let forceRepairId: string | null = null
    let index = 0
    while (index < workflow.steps.length) {
      const step = workflow.steps[index]
      const stepRun = run.steps[index]
      if (step.repair && forceRepairId !== step.id) {
        stepRun.status = "skipped"
        stepRun.finishedAt = new Date().toISOString()
        await update()
        index++
        continue
      }
      if (forceRepairId === step.id) forceRepairId = null
      const agent = all.find((a) => a.type === "agent" && a.name === step.agent)
      if (!agent) throw new StepFailure(`Agent "${step.agent}" was not found`)

      let llm: ResolvedLlm
      try {
        const layers = stepModelLayers(workflow, step, agent)
        const options = stepResolveOptions(workflow, step, agent, settings, credentialCache)
        // The resolver knows the final provider after all fallback rules and
        // owns the provider+model cache. Do not cache by a partial preview:
        // two model ids without an explicit provider would otherwise collide.
        llm = await deps.resolveLlm(layers, options)
      } catch (err) {
        throw new StepFailure(errorText(err))
      }
      stepRun.provider = llm.provider.id
      stepRun.model = llm.model
      if (llm.source) stepRun.modelSource = llm.source
      if (llm.task) stepRun.task = llm.task

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
      sections.push(knowledge)
      const configuredFiles = run.stepFiles?.[step.id] ?? step.files ?? []
      const mentionedFiles = [
        ...parseFileMentions(run.task),
        ...parseFileMentions(step.instructions),
      ]
      const wantedFileNames = [...new Set([...configuredFiles, ...mentionedFiles])]
      const fileResolver = deps.resolveFiles ?? resolveWorkspaceFiles
      const stepWorkspaceFiles =
        wantedFileNames.length > 0
          ? await fileResolver(run.workspaceRoot, wantedFileNames)
          : []
      policy.allowWrites = step.allowWrites
      policy.allowFileWrites = false

      let retryNote: string | undefined
      let loginNote: string | undefined
      let includeLoginTool = step.login
      let loginPauseUsed = false
      let gate: StepGateResult | undefined
      const loginIds = loginSecretIds(workflow.name, step.id)

      if (step.login && !(await loginSecretsReady(loginIds.username, loginIds.password))) {
        audit({
          type: "login_pause",
          ts: auditNow(),
          stepId: step.id,
          reason: "This step needs a username and password before it can sign in.",
        })
        const decision = await pauseForLogin({
          run,
          stepRun,
          stepId: step.id,
          usernameSecret: loginIds.username,
          passwordSecret: loginIds.password,
          reason: "This step needs a username and password before it can sign in.",
          signal: runSignal,
          update,
        })
        loginPauseUsed = true
        if (decision.action === "cancel") {
          throw new StepFailure(`Step "${step.id}" failed: login was not provided`)
        }
        if (decision.action === "already") loginNote = alreadyLoggedInNote()
      }

      audit({
        type: "step_started",
        ts: auditNow(),
        stepId: step.id,
        agent: step.agent,
        model: llm.model,
        provider: llm.provider.id,
      })

      for (;;) {
        stepRun.attempts++
        stepRun.status = "running"
        stepRun.startedAt = new Date().toISOString()
        stepRun.error = undefined
        stepRun.toolExecutions = []
        stepRun.maxTurns = step.maxTurns
        stepRun.turn = undefined
        stepRun.recent = []
        stepRun.lastActivityAt = stepRun.startedAt
        stepRun.activity = {
          kind: "waiting_model",
          label: "Starting…",
          since: stepRun.startedAt,
        }
        await update()

        const stepSignal = AbortSignal.any([
          runSignal,
          AbortSignal.timeout(workflow.limits.stepTimeoutMinutes * 60_000),
        ])
        const live = createThrottledUpdate(update)
        const approve = createRegistryApprover({
          scope: { kind: "run", runId: run.id, stepId: step.id, workflow: workflow.name },
          signal: stepSignal,
          onRequest: async (request) => {
            run.status = "waiting_approval"
            stepRun.status = "waiting_approval"
            run.pendingApproval = request
            applyLoopEventToStep(stepRun, { type: "approval_required", approval: request })
            audit({
              type: "approval_requested",
              ts: auditNow(),
              stepId: step.id,
              attempt: stepRun.attempts,
              approvalId: request.id,
              tool: request.tool,
              summary: request.summary,
            })
            await live.flush()
            await update()
          },
          onResolved: async (request, decision) => {
            run.status = "running"
            stepRun.status = "running"
            run.pendingApproval = null
            applyLoopEventToStep(stepRun, {
              type: "approval_resolved",
              id: request.id,
              approved: decision.approved,
            })
            audit({
              type: "approval_resolved",
              ts: auditNow(),
              stepId: step.id,
              attempt: stepRun.attempts,
              approvalId: request.id,
              approved: decision.approved,
            })
            await live.flush()
            await update()
          },
        })

        const onEvent = (event: AgentLoopEvent): void => {
          applyLoopEventToStep(stepRun, event)
          if (event.type === "tool_call") {
            audit(
              toolCallEvent({
                stepId: step.id,
                attempt: stepRun.attempts,
                turn: stepRun.turn,
                id: event.id,
                tool: event.tool,
                server: event.server,
                risk: event.risk,
                args: event.args,
              })
            )
          } else if (event.type === "tool_result") {
            audit({
              type: "tool_result",
              ts: auditNow(),
              stepId: step.id,
              attempt: stepRun.attempts,
              turn: stepRun.turn,
              id: event.trace.id,
              tool: event.trace.tool,
              server: event.trace.server,
              result:
                event.trace.result !== undefined
                  ? truncateResult(event.trace.result)
                  : undefined,
              error: event.trace.error,
              durationMs: event.trace.durationMs ?? 0,
            })
          }
          live.notify()
        }

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
                  files: stepWorkspaceFiles,
                  retryNote,
                  loginNote,
                  reviewFeedback: reviewFeedback.get(step.id),
                }),
              },
            ],
            systemContext: sections.join("\n\n"),
            tools: includeLoginTool ? [...tools, browserFillLoginTool] : tools,
            maxTurns: step.maxTurns,
            workspaceRoot: run.workspaceRoot,
            policy,
            approve,
            onEvent,
            onLlmExchange: (exchange) => {
              audit(
                llmRequestEvent({
                  stepId: step.id,
                  attempt: stepRun.attempts,
                  turn: exchange.turn,
                  model: exchange.model,
                  provider: llm.provider.id,
                  systemContext: exchange.systemContext,
                  messages: exchange.messages,
                })
              )
              audit(
                llmResponseEvent({
                  stepId: step.id,
                  attempt: stepRun.attempts,
                  turn: exchange.turn,
                  model: exchange.model,
                  provider: llm.provider.id,
                  content: exchange.content,
                  reasoning: exchange.reasoning,
                  toolCalls: exchange.toolCalls,
                  durationMs: exchange.durationMs,
                  usage: exchange.usage,
                })
              )
            },
            signal: stepSignal,
          })
          content = result.content
          // Tool traces were pushed live via onEvent; keep a final sync if empty.
          if (stepRun.toolExecutions.length === 0 && result.toolExecutions.length > 0) {
            stepRun.toolExecutions.push(...result.toolExecutions)
          }
          await live.flush()
          const loginError = toolLoginError(stepRun.toolExecutions)
          if (loginError && !loginPauseUsed) {
            audit({
              type: "login_pause",
              ts: auditNow(),
              stepId: step.id,
              attempt: stepRun.attempts,
              reason: loginError,
            })
            const decision = await pauseForLogin({
              run,
              stepRun,
              stepId: step.id,
              usernameSecret: loginIds.username,
              passwordSecret: loginIds.password,
              reason: "The page asked for a login. Enter the username and password to continue this step.",
              signal: runSignal,
              update,
            })
            loginPauseUsed = true
            includeLoginTool = true
            if (decision.action === "cancel") {
              throw new StepFailure(`Step "${step.id}" failed: login was not provided`)
            }
            loginNote = decision.action === "already" ? alreadyLoggedInNote() : loginStepNote(workflow.name, step.id)
            retryNote =
              decision.action === "already"
                ? "The user signed in in the browser. Continue from there."
                : "The user saved the username and password. Sign in with browser_fill_login, then continue."
            continue
          }
          if (loginError) {
            stepRun.status = "failed"
            stepRun.error = loginError
            stepRun.finishedAt = new Date().toISOString()
            clearLiveStepFields(stepRun)
            throw new StepFailure(`Step "${step.id}" failed: ${loginError}`)
          }
        } catch (err) {
          await live.flush()
          if (err instanceof StepFailure) throw err
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
          clearLiveStepFields(stepRun)
          audit({
            type: "error",
            ts: auditNow(),
            stepId: step.id,
            attempt: stepRun.attempts,
            message: reason,
          })
          throw new StepFailure(`Step "${step.id}" failed: ${reason}`)
        }

        stepRun.output = content
        stepRun.filesChanged = filesChangedBy(stepRun.toolExecutions)
        stepRun.verdict = step.review ? (parseReviewVerdict(content) ?? undefined) : undefined
        gate = step.gate
          ? await decideGate({ resolved, workflow, run, step: stepRun, instructions: step.instructions, isLast: index === workflow.steps.length - 1 })
          : undefined
        stepRun.gate = gate
        if (gate) {
          audit({
            type: "gate",
            ts: auditNow(),
            stepId: step.id,
            attempt: stepRun.attempts,
            decision: gate.decision,
            by: gate.by,
            confidence: gate.confidence,
          })
        }
        if (gate?.decision === "retry" && stepRun.attempts <= workflow.limits.maxRetries) {
          retryNote = "A reviewer judged your last answer incomplete or off-task. Try again and finish the job."
          audit({
            type: "retry",
            ts: auditNow(),
            stepId: step.id,
            attempt: stepRun.attempts,
            reason: retryNote,
          })
          continue
        }
        break
      }

      stepRun.status = "succeeded"
      stepRun.finishedAt = new Date().toISOString()
      clearLiveStepFields(stepRun)
      await update()
      audit({
        type: "step_finished",
        ts: auditNow(),
        stepId: step.id,
        attempt: stepRun.attempts,
        status: "succeeded",
      })

      reviewFeedback.delete(step.id)

      if (step.review && stepRun.verdict === "reject" && step.onReject) {
        const used = sentBack.get(step.id) ?? 0
        const targetIndex = workflow.steps.findIndex((s) => s.id === step.onReject?.step)
        if (used < step.onReject.maxRounds && targetIndex >= 0) {
          const round = used + 1
          sentBack.set(step.id, round)
          stepRun.sentBack = round
          const reasons = reviewReasons(stepRun.output ?? "")
          reviewFeedback.set(step.onReject.step, reasons || stepRun.output || "The review rejected the work.")
          forceRepairId = step.onReject.step
          for (let i = targetIndex; i < index; i++) resetStepForRerun(run.steps[i])
          audit({
            type: "review_sent_back",
            ts: auditNow(),
            stepId: step.id,
            attempt: stepRun.attempts,
            targetStep: step.onReject.step,
            round,
            maxRounds: step.onReject.maxRounds,
            reasons: reasons || "The review rejected the work.",
          })
          await update()
          index = targetIndex
          continue
        }
        throw new StepFailure(
          `Step "${step.id}" rejected the work after ${used} fix round${used === 1 ? "" : "s"}.`
        )
      }

      if (gate?.decision === "stop") {
        return await finish("succeeded", {
          report: clipReport(`Stopped early after "${step.id}".\n\n${stepRun.output ?? ""}`),
        })
      }
      index++
    }

    const last = run.steps[run.steps.length - 1]
    return await finish("succeeded", { report: clipReport(last.output ?? "") })
  } catch (err) {
    if (cancelSignal.aborted) return finish("cancelled", { error: "Cancelled by the user" })
    return finish("failed", { error: errorText(err) })
  }
}

function resetStepForRerun(step: StepRun): void {
  step.status = "pending"
  step.attempts = 0
  step.output = undefined
  step.error = undefined
  step.verdict = undefined
  step.gate = undefined
  step.toolExecutions = []
  step.filesChanged = []
  step.startedAt = undefined
  step.finishedAt = undefined
  clearLiveStepFields(step)
}

function toolLoginError(traces: ToolExecutionTrace[]): string | null {
  for (const trace of traces) {
    if (!trace.error) continue
    if (trace.error.includes("LOGIN_REQUIRED") || looksLikeAuthFailure(trace.error)) return trace.error
  }
  return null
}

async function loginSecretsReady(usernameSecret: string, passwordSecret: string): Promise<boolean> {
  const secrets = await getBrowserSecrets()
  return Boolean(secrets[usernameSecret]?.trim() && secrets[passwordSecret])
}

async function pauseForLogin(params: {
  run: WorkflowRun
  stepRun: StepRun
  stepId: string
  usernameSecret: string
  passwordSecret: string
  reason: string
  signal: AbortSignal
  update: () => Promise<void>
}): Promise<LoginDecision> {
  const handle = requestLogin(
    {
      stepId: params.stepId,
      usernameSecret: params.usernameSecret,
      passwordSecret: params.passwordSecret,
      reason: params.reason,
    },
    { signal: params.signal }
  )
  params.run.status = "waiting_login"
  params.stepRun.status = "waiting_login"
  params.run.pendingLogin = handle.request
  params.run.pendingApproval = null
  await params.update()
  const decision = await handle.decision
  params.run.pendingLogin = null
  params.run.status = "running"
  params.stepRun.status = "running"
  await params.update()
  return decision
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
