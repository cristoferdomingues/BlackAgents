import { z } from "zod"

import { BROWSER_MCP_SERVER } from "@/lib/browser/constants"
import { readBrowserFlow } from "@/lib/browser/flows/store"
import { browserUnavailableReason } from "@/lib/browser/platform"
import { ensureBrowserProfile, reLoginHint } from "@/lib/browser/profile"
import { executeWorkspaceTool } from "@/lib/mcp/client"

import type { RuntimeTool } from "../types"

const argsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Flow name must be kebab-case"),
})

function looksLikeAuthFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("session") ||
    lower.includes("authenticate")
  )
}

export const browserRunFlowTool: RuntimeTool = {
  name: "browser_run_flow",
  originalName: "browser_run_flow",
  server: "builtin",
  source: "builtin",
  risk: "exec",
  description:
    "Replay a saved browser flow from .black-agents/browser-flows/<name>.json using the Playwright MCP server. Desktop (Electron) only.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Kebab-case flow name (file stem under .black-agents/browser-flows/)",
      },
    },
    required: ["name"],
  },
  summarize: (args) => `browser_run_flow(${JSON.stringify(args).slice(0, 120)})`,
  async execute(rawArgs, ctx) {
    const unavailable = browserUnavailableReason()
    if (unavailable) {
      return { error: unavailable }
    }

    const parsed = argsSchema.safeParse(rawArgs)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid arguments" }
    }

    const flow = await readBrowserFlow(ctx.workspaceRoot, parsed.data.name)
    if (!flow) {
      return {
        error: `Browser flow "${parsed.data.name}" was not found in .black-agents/browser-flows/`,
      }
    }

    const profile = await ensureBrowserProfile(flow.profile)
    if (!profile.ok) {
      return { error: profile.error }
    }
    if (!profile.exists) {
      return {
        error: reLoginHint(profile.profileDir),
      }
    }

    if (flow.steps.length === 0) {
      return { error: `Flow "${flow.name}" has no steps to run` }
    }

    const results: Array<{ tool: string; ok: boolean; error?: string }> = []
    for (const step of flow.steps) {
      const trace = await executeWorkspaceTool(
        ctx.workspaceRoot,
        BROWSER_MCP_SERVER,
        step.tool,
        step.args
      )
      if (trace.error) {
        const hint = looksLikeAuthFailure(trace.error)
          ? ` ${reLoginHint(profile.profileDir)}`
          : ""
        results.push({ tool: step.tool, ok: false, error: trace.error })
        return {
          error: `Flow "${flow.name}" failed on ${step.tool}: ${trace.error}.${hint}`,
          result: { flow: flow.name, results },
        }
      }
      results.push({ tool: step.tool, ok: true })
    }

    return {
      result: {
        flow: flow.name,
        stepsRun: results.length,
        results,
      },
    }
  },
}
