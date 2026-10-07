import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { fsListTool, fsReadTool, fsWriteTool } from "@/lib/runtime/tools/fs"
import { agentToolScope, builtinTools, buildToolset } from "@/lib/runtime/tools"
import { mcpToolName, toRuntimeTool } from "@/lib/runtime/tools/mcp"
import { runProcess, shellRunTool } from "@/lib/runtime/tools/shell"
import type { Artifact } from "@/lib/artifacts/types"

import { makeTempEnv, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
const ctx = () => ({ workspaceRoot: env.workspace })

beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

describe("file tools", () => {
  it("lists, reads, and writes inside the workspace", async () => {
    await writeFile(path.join(env.workspace, "a.txt"), "hello")
    await mkdir(path.join(env.workspace, "node_modules"))
    expect((await fsListTool.execute({}, ctx())).result).toEqual({ path: ".", entries: ["a.txt"] })
    expect((await fsReadTool.execute({ path: "a.txt" }, ctx())).result).toMatchObject({
      content: "hello",
      truncated: false,
    })
    const written = await fsWriteTool.execute({ path: "src/b.ts", content: "x" }, ctx())
    expect(written.result).toEqual({ path: "src/b.ts", bytes: 1 })
    expect(await readFile(path.join(env.workspace, "src/b.ts"), "utf8")).toBe("x")
  })

  it("blocks traversal and protected folders", async () => {
    await expect(fsReadTool.execute({ path: "../secret" }, ctx())).rejects.toThrow(/escapes/)
    expect((await fsWriteTool.execute({ path: ".black-agents/brain/x.md", content: "x" }, ctx())).error).toMatch(/not allowed/)
    expect((await fsWriteTool.execute({ path: ".git/config", content: "x" }, ctx())).error).toMatch(/not allowed/)
    expect((await fsReadTool.execute({ path: "missing.txt" }, ctx())).error).toMatch(/Not a file/)
    expect((await fsListTool.execute({ path: "nope" }, ctx())).error).toMatch(/Not found/)
    expect((await fsWriteTool.execute({}, ctx())).error).toBeDefined()
  })

  it("escalates writes to agent config to exec risk", () => {
    expect(fsWriteTool.riskFor?.({ path: "src/a.ts" })).toBe("write")
    expect(fsWriteTool.riskFor?.({ path: ".cursor/rules/x.mdc" })).toBe("exec")
    expect(fsWriteTool.riskFor?.({ path: "./.claude/agents/a.md" })).toBe("exec")
  })
})

describe("shell tool", () => {
  it("runs a program without a shell and captures output", async () => {
    const outcome = await shellRunTool.execute(
      { command: "node", args: ["-e", "process.stdout.write('hi')"] },
      ctx()
    )
    expect(outcome.error).toBeUndefined()
    expect(outcome.result).toMatchObject({ exitCode: 0, stdout: "hi" })
  })

  it("rejects shell syntax in the command and reports failures", async () => {
    expect((await shellRunTool.execute({ command: "ls; rm -rf /" }, ctx())).error).toMatch(/shell syntax/)
    const failed = await shellRunTool.execute({ command: "node", args: ["-e", "process.exit(3)"] }, ctx())
    expect(failed.error).toBe("Command exited with code 3")
    const missing = await shellRunTool.execute({ command: "definitely-not-a-program-xyz" }, ctx())
    expect(missing.error).toBeDefined()
  })

  it("times out long commands", async () => {
    const result = await runProcess("node", ["-e", "setTimeout(()=>{}, 5000)"], {
      cwd: env.workspace,
      timeoutMs: 100,
    })
    expect(result.timedOut).toBe(true)
  })

  it("summarizes the command for approvals", () => {
    expect(shellRunTool.summarize?.({ command: "npm", args: ["test"] })).toBe("$ npm test")
  })
})

describe("tool scope", () => {
  const agent = (frontmatter: Record<string, unknown>): Artifact => ({
    name: "a",
    type: "agent",
    platform: "cursor",
    description: "",
    frontmatter,
    body: "",
    relativePath: "",
  })

  it("defaults to read-only files and all MCP servers", () => {
    expect(agentToolScope(agent({}))).toEqual({ builtins: ["fs_list", "fs_read"], mcpServers: undefined })
  })

  it("reads tools and servers from frontmatter, ignoring unknown tools", () => {
    expect(agentToolScope(agent({ tools: ["shell_run", "bogus"], mcpServers: ["github"] }))).toEqual({
      builtins: ["shell_run"],
      mcpServers: ["github"],
    })
  })

  it("builds a toolset without MCP when the workspace has no servers", async () => {
    const tools = await buildToolset(env.workspace, { builtins: ["fs_read", "fs_read"] })
    expect(tools.map((t) => t.name)).toEqual(["fs_read"])
    expect(builtinTools([]).length).toBe(0)
  })

  it("maps MCP trust to risk and sanitizes names", () => {
    const mcp = { server: "my server", name: "do.thing", inputSchema: {} }
    expect(mcpToolName("my server", "do.thing")).toBe("my_server__do_thing")
    expect(toRuntimeTool(mcp, "trusted").risk).toBe("read")
    expect(toRuntimeTool(mcp, "ask").risk).toBe("write")
    expect(toRuntimeTool(mcp, "risky").risk).toBe("exec")
  })
})
