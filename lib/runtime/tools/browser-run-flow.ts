import { z } from "zod"

import { readBrowserFlow } from "@/lib/browser/flows/store"
import { browserUnavailableReason } from "@/lib/browser/platform"
import { replayBrowserFlow } from "@/lib/browser/replay"

import type { RuntimeTool } from "../types"
import { toolArgsError } from "./args"

const argsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Flow name must be kebab-case"),
})

export const browserRunFlowTool: RuntimeTool = {
  name: "browser_run_flow",
  originalName: "browser_run_flow",
  server: "builtin",
  source: "builtin",
  risk: "exec",
  description:
    "Replay a saved browser flow from .black-agents/browser-flows/<name>.json using the Playwright MCP server. Desktop (Electron) only. Supports intent self-heal, asserts, and secret fills. A flow with auto-accept runs its saved steps with no approval card.",
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
      return { error: toolArgsError(parsed.error) }
    }

    const flow = await readBrowserFlow(ctx.workspaceRoot, parsed.data.name)
    if (!flow) {
      return {
        error: `Browser flow "${parsed.data.name}" was not found in .black-agents/browser-flows/`,
      }
    }

    const outcome = await replayBrowserFlow(ctx.workspaceRoot, flow)
    if (!outcome.ok) {
      return {
        error: outcome.error,
        result: outcome.result,
      }
    }

    return { result: outcome.result }
  },
}
