import { z } from "zod"

import { fillLoginFields, findLoginFields } from "@/lib/browser/fill-login"
import { BROWSER_MCP_SERVER } from "@/lib/browser/constants"
import { browserUnavailableReason } from "@/lib/browser/platform"
import { executeWorkspaceTool } from "@/lib/mcp/client"
import { isBrowserSecretId } from "@/lib/browser/secrets"
import { getBrowserSecrets } from "@/lib/secrets"

import type { RuntimeTool } from "../types"
import { toolArgsError } from "./args"

const argsSchema = z.object({
  usernameSecretId: z.string().trim().min(1),
  passwordSecretId: z.string().trim().min(1),
})

function snapshotText(result: unknown): string {
  if (typeof result === "string") return result
  if (result == null) return ""
  return JSON.stringify(result)
}

export const browserFillLoginTool: RuntimeTool = {
  name: "browser_fill_login",
  originalName: "browser_fill_login",
  server: "builtin",
  source: "builtin",
  risk: "exec",
  description:
    "Fill the current page's username and password from saved browser secrets, then click Sign in. Pass secret ids only. Never pass the password itself. Desktop app only.",
  parameters: {
    type: "object",
    properties: {
      usernameSecretId: {
        type: "string",
        description: "Secret id for the username, such as browser.my-workflow.step-1.username",
      },
      passwordSecretId: {
        type: "string",
        description: "Secret id for the password, such as browser.my-workflow.step-1.password",
      },
    },
    required: ["usernameSecretId", "passwordSecretId"],
  },
  summarize: (args) =>
    `Fill login (${typeof args.usernameSecretId === "string" ? args.usernameSecretId : "username"})`,
  async execute(rawArgs, ctx) {
    const unavailable = browserUnavailableReason()
    if (unavailable) return { error: unavailable }

    const parsed = argsSchema.safeParse(rawArgs)
    if (!parsed.success) return { error: toolArgsError(parsed.error) }
    const { usernameSecretId, passwordSecretId } = parsed.data
    if (!isBrowserSecretId(usernameSecretId) || !isBrowserSecretId(passwordSecretId)) {
      return { error: "Secret ids must look like browser.<name>." }
    }

    const secrets = await getBrowserSecrets()
    const username = secrets[usernameSecretId]?.trim() ?? ""
    const password = secrets[passwordSecretId] ?? ""
    if (!username || !password) {
      return {
        error: `LOGIN_REQUIRED: save the username and password for ${usernameSecretId} and ${passwordSecretId}.`,
      }
    }

    const snap = await executeWorkspaceTool(ctx.workspaceRoot, BROWSER_MCP_SERVER, "browser_snapshot", {})
    if (snap.error) return { error: "Could not read the page before filling the login." }
    const fields = findLoginFields(snapshotText(snap.result))
    const filled = await fillLoginFields({
      username,
      password,
      fields,
      typeText: async (ref, text, element, submit) => {
        const trace = await executeWorkspaceTool(ctx.workspaceRoot, BROWSER_MCP_SERVER, "browser_type", {
          ref,
          text,
          element,
          submit,
        })
        return trace.error
      },
      click: async (ref, element) => {
        const trace = await executeWorkspaceTool(ctx.workspaceRoot, BROWSER_MCP_SERVER, "browser_click", {
          ref,
          element,
        })
        return trace.error
      },
    })
    if (!filled.ok) return { error: filled.error }
    return { result: { filled: true } }
  },
}
