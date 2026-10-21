import { z } from "zod"

import { pathExists } from "@/lib/fs-service"
import { testMcpServer } from "@/lib/mcp/client"
import { readWorkspaceMcpConfig, saveWorkspaceMcpServer } from "@/lib/mcp/config"
import { setMcpServerTrust } from "@/lib/mcp/policy"
import { mcpServerConfigSchema } from "@/lib/mcp/types"

import { K0dingError } from "./errors"
import { resolveInRoot } from "./paths"
import { readCodeFile } from "./read-file"
import { mcpTrySchema, type CodeRoot } from "./schema"

const packageSchema = z.object({
  dependencies: z.record(z.string()).optional(),
  devDependencies: z.record(z.string()).optional(),
  scripts: z.record(z.string()).optional(),
})

export interface McpCandidate {
  detected: boolean
  packageManager: "npm" | "pnpm" | "yarn" | "bun"
  scripts: string[]
  existingServer: boolean
}

async function packageManager(root: string): Promise<McpCandidate["packageManager"]> {
  if (await pathExists(resolveInRoot(root, "pnpm-lock.yaml"))) return "pnpm"
  if (await pathExists(resolveInRoot(root, "yarn.lock"))) return "yarn"
  if (await pathExists(resolveInRoot(root, "bun.lockb"))) return "bun"
  return "npm"
}

async function readPackage(root: CodeRoot): Promise<z.infer<typeof packageSchema> | null> {
  try {
    const file = await readCodeFile(root.path, "package.json")
    if (!file.content) return null
    const parsed = packageSchema.safeParse(JSON.parse(file.content) as unknown)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function detectMcpCandidate(workspace: string, root: CodeRoot): Promise<McpCandidate> {
  const pkg = await readPackage(root)
  const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const config = await readWorkspaceMcpConfig(workspace)
  return {
    detected: "@modelcontextprotocol/sdk" in dependencies,
    packageManager: await packageManager(root.path),
    scripts: Object.keys(pkg?.scripts ?? {}).sort().slice(0, 50),
    existingServer: root.id in config.mcpServers,
  }
}

function commandFor(manager: McpCandidate["packageManager"], root: string, script: string): { command: string; args: string[] } {
  if (manager === "npm") return { command: "npm", args: ["--prefix", root, "run", script] }
  if (manager === "pnpm") return { command: "pnpm", args: ["--dir", root, "run", script] }
  if (manager === "yarn") return { command: "yarn", args: ["--cwd", root, script] }
  return { command: "bun", args: ["--cwd", root, "run", script] }
}

export async function tryAndSaveMcpServer(
  workspace: string,
  root: CodeRoot,
  body: unknown
): Promise<{ name: string; tools: Array<{ name: string; description?: string }> }> {
  const parsed = mcpTrySchema.safeParse(body)
  if (!parsed.success) throw new K0dingError(parsed.error.issues[0]?.message ?? "Invalid MCP server")
  const candidate = await detectMcpCandidate(workspace, root)
  if (!candidate.detected) throw new K0dingError("This project does not use the MCP SDK")
  if (!candidate.scripts.includes(parsed.data.script)) throw new K0dingError("Choose a script from package.json")
  const launch = commandFor(candidate.packageManager, root.path, parsed.data.script)
  const config = mcpServerConfigSchema.parse({ ...launch, transport: "stdio" })
  const status = await testMcpServer(parsed.data.name, config, root.path)
  if (status.status !== "connected") {
    throw new K0dingError(status.error ?? "The MCP server did not connect", 422)
  }
  await saveWorkspaceMcpServer(workspace, parsed.data.name, config)
  await setMcpServerTrust(workspace, parsed.data.name, "ask")
  return {
    name: parsed.data.name,
    tools: status.tools.map((tool) => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}) })),
  }
}
