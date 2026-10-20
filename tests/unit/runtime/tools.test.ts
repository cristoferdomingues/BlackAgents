import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { pathExists } from "@/lib/fs-service"
import { expandBuiltinTools } from "@/lib/runtime/tool-names"
import {
  fsEditTool,
  fsFindTool,
  fsListTool,
  fsReadTool,
  fsSearchTool,
  fsWriteTool,
} from "@/lib/runtime/tools/fs"
import { agentToolScope, ASSISTANT_TOOL_SCOPE, builtinTools, buildToolset } from "@/lib/runtime/tools"
import { brainProposeReverificationTool } from "@/lib/runtime/tools/brain"
import { mcpToolName, toRuntimeTool } from "@/lib/runtime/tools/mcp"
import { isCommandLine, runProcess, shellRunTool } from "@/lib/runtime/tools/shell"
import type { Artifact } from "@/lib/artifacts/types"
import { listProposals } from "@/lib/brain/store"

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

  it("lists a folder inside the fs_read error", async () => {
    await mkdir(path.join(env.workspace, "lib/llm"), { recursive: true })
    await writeFile(path.join(env.workspace, "lib/llm/types.ts"), "export {}")
    const error = (await fsReadTool.execute({ path: "lib/llm" }, ctx())).error
    expect(error).toContain('"lib/llm" is a folder, not a file.')
    expect(error).toContain("- types.ts")
    expect(error).toContain("do not call fs_list")
  })

  it("explains an artifact name instead of treating it as a file path", async () => {
    await mkdir(path.join(env.workspace, ".cursor/rules"), { recursive: true })
    await writeFile(path.join(env.workspace, ".cursor/rules/typescript-strict.mdc"), "# strict")
    expect((await fsReadTool.execute({ path: "typescript-strict" }, ctx())).error).toContain(
      "Its file is .cursor/rules/typescript-strict.mdc"
    )
    expect((await fsReadTool.execute({ path: "missing-rule" }, ctx())).error).toContain(
      "looks like an artifact name"
    )
  })

  it("blocks traversal and protected folders", async () => {
    await expect(fsReadTool.execute({ path: "../secret" }, ctx())).rejects.toThrow(/escapes/)
    expect((await fsWriteTool.execute({ path: ".black-agents/brain/x.md", content: "x" }, ctx())).error).toMatch(/not allowed/)
    expect((await fsWriteTool.execute({ path: ".black-agents/files/x/a.txt", content: "x" }, ctx())).error).toMatch(/not allowed/)
    expect((await fsWriteTool.execute({ path: ".git/config", content: "x" }, ctx())).error).toMatch(/not allowed/)
    expect((await fsReadTool.execute({ path: "missing.txt" }, ctx())).error).toBe("Not found: missing.txt")
    expect((await fsListTool.execute({ path: "nope" }, ctx())).error).toMatch(/Not found/)
    expect((await fsWriteTool.execute({}, ctx())).error).toBeDefined()
  })

  it("escalates writes to agent config to exec risk", () => {
    expect(fsWriteTool.riskFor?.({ path: "src/a.ts" })).toBe("write")
    expect(fsWriteTool.riskFor?.({ path: ".cursor/rules/x.mdc" })).toBe("exec")
    expect(fsWriteTool.riskFor?.({ path: "./.claude/agents/a.md" })).toBe("exec")
  })

  it("refuses a knowledge concept with no OKF frontmatter, leaving nothing on disk", async () => {
    const result = await fsWriteTool.execute(
      { path: ".black-agents/knowledge/crypto/portfolio-metrics.md", content: "# Just a heading\n\nSome notes.\n" },
      ctx()
    )
    expect(result.error).toContain("not a valid OKF knowledge concept")
    expect(result.error).toContain("type is required")
    expect(result.error).toContain("```knowledge draft block")
    expect(
      await pathExists(path.join(env.workspace, ".black-agents/knowledge/crypto/portfolio-metrics.md"))
    ).toBe(false)
  })

  it("refuses a badly-named knowledge file", async () => {
    const result = await fsWriteTool.execute(
      { path: ".black-agents/knowledge/Portfolio Metrics.md", content: "---\ntype: Definition\n---\n\nBody.\n" },
      ctx()
    )
    expect(result.error).toContain("not a valid knowledge concept path")
  })

  it("accepts a knowledge file with valid OKF frontmatter", async () => {
    const content = "---\ntype: Definition\ntitle: Portfolio metrics\ndescription: How it is measured.\n---\n\nBody.\n"
    const result = await fsWriteTool.execute(
      { path: ".black-agents/knowledge/crypto/portfolio-metrics.md", content },
      ctx()
    )
    expect(result.error).toBeUndefined()
    expect(result.result).toMatchObject({ path: ".black-agents/knowledge/crypto/portfolio-metrics.md" })
    expect(
      await readFile(path.join(env.workspace, ".black-agents/knowledge/crypto/portfolio-metrics.md"), "utf8")
    ).toBe(content)
  })

  it("lets index.md and log.md stay plain markdown", async () => {
    for (const name of ["index.md", "log.md"]) {
      const result = await fsWriteTool.execute(
        { path: `.black-agents/knowledge/${name}`, content: "# Just navigation, no frontmatter\n" },
        ctx()
      )
      expect(result.error).toBeUndefined()
    }
  })

  it("fs_edit also refuses an edit that leaves a knowledge concept invalid", async () => {
    await mkdir(path.join(env.workspace, ".black-agents/knowledge"), { recursive: true })
    await writeFile(
      path.join(env.workspace, ".black-agents/knowledge/revenue.md"),
      "---\ntype: Metric\ntitle: Revenue\n---\n\nOld body.\n"
    )
    const broken = await fsEditTool.execute(
      {
        path: ".black-agents/knowledge/revenue.md",
        oldText: "---\ntype: Metric\ntitle: Revenue\n---\n\n",
        newText: "",
      },
      ctx()
    )
    expect(broken.error).toContain("not a valid OKF knowledge concept")
    expect(await readFile(path.join(env.workspace, ".black-agents/knowledge/revenue.md"), "utf8")).toContain(
      "Old body."
    )

    const fixed = await fsEditTool.execute(
      { path: ".black-agents/knowledge/revenue.md", oldText: "Old body.", newText: "New body." },
      ctx()
    )
    expect(fixed.error).toBeUndefined()
  })
})

describe("brain tools", () => {
  it("queues a workspace-confined re-verification proposal and deduplicates it", async () => {
    const dir = path.join(env.workspace, ".black-agents/knowledge/architecture")
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, "workflows.md"),
      "---\ntype: Reference\ntitle: Workflows\n---\n\n# Workflows\n"
    )
    const args = {
      conceptId: "architecture/workflows",
      reason: "Generated after the latest verification.",
    }
    const first = await brainProposeReverificationTool.execute(args, {
      workspaceRoot: env.workspace,
      runId: "run-1",
    })
    const duplicate = await brainProposeReverificationTool.execute(args, {
      workspaceRoot: env.workspace,
      runId: "run-1",
    })
    expect(first.result).toMatchObject({ conceptId: "architecture/workflows", created: true })
    expect(duplicate.result).toMatchObject({ conceptId: "architecture/workflows", created: false })
    expect(await listProposals(env.workspace)).toHaveLength(1)
    expect((await brainProposeReverificationTool.execute({}, ctx())).error).toContain("conceptId")
    expect(
      (
        await brainProposeReverificationTool.execute(
          { conceptId: "architecture/missing", reason: "Missing." },
          ctx()
        )
      ).error
    ).toContain("does not exist")
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

  it("runs a full command line through the shell, inside the workspace", async () => {
    const outcome = await shellRunTool.execute(
      { command: "printf one > out.txt && cat out.txt | tr a-z A-Z" },
      ctx()
    )
    expect(outcome.error).toBeUndefined()
    expect(outcome.result).toMatchObject({ exitCode: 0, stdout: "ONE" })
    expect(await readFile(path.join(env.workspace, "out.txt"), "utf8")).toBe("one")
  })

  it("runs in a sub folder and keeps cwd inside the workspace", async () => {
    await mkdir(path.join(env.workspace, "app"))
    const outcome = await shellRunTool.execute({ command: "pwd", cwd: "app" }, ctx())
    expect(String((outcome.result as { stdout: string }).stdout).trim().endsWith("/app")).toBe(true)
    await expect(shellRunTool.execute({ command: "pwd", cwd: "../" }, ctx())).rejects.toThrow(/escapes/)
  })

  it("reports failures and missing programs", async () => {
    const failed = await shellRunTool.execute({ command: "node", args: ["-e", "process.exit(3)"] }, ctx())
    expect(failed.error).toBe("Command exited with code 3")
    const missing = await shellRunTool.execute({ command: "definitely-not-a-program-xyz" }, ctx())
    expect(missing.error).toMatch(/Program not found: definitely-not-a-program-xyz/)
    const missingLine = await shellRunTool.execute({ command: "definitely-not-a-program-xyz --version" }, ctx())
    expect(missingLine.error).toMatch(/Program not found/)
    expect((await shellRunTool.execute({ command: "  " }, ctx())).error).toBeDefined()
    expect((await shellRunTool.execute({ command: "x".repeat(201), args: ["a"] }, ctx())).error).toMatch(/too long/)
  })

  it("tells a program from a command line", () => {
    expect(isCommandLine("node", [])).toBe(false)
    expect(isCommandLine("./bin/run", [])).toBe(false)
    expect(isCommandLine("npm test", [])).toBe(true)
    expect(isCommandLine("a|b", [])).toBe(true)
    expect(isCommandLine("npm", ["test"])).toBe(false)
  })

  it("stops a command when the run is cancelled", async () => {
    const controller = new AbortController()
    const pending = runProcess("sleep 5", [], {
      cwd: env.workspace,
      timeoutMs: 10_000,
      signal: controller.signal,
      shell: true,
    })
    setTimeout(() => controller.abort(), 50)
    const result = await pending
    expect(result.exitCode).not.toBe(0)
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
    expect(shellRunTool.summarize?.({ command: "pnpm i", cwd: "web" })).toBe("$ pnpm i (in web)")
  })
})

describe("find, search and edit tools", () => {
  beforeEach(async () => {
    await mkdir(path.join(env.workspace, "src/lib"), { recursive: true })
    await mkdir(path.join(env.workspace, "node_modules/pkg"), { recursive: true })
    await writeFile(path.join(env.workspace, "src/a.ts"), "export const a = 1\nconst Hello = 2\n")
    await writeFile(path.join(env.workspace, "src/lib/b.ts"), "hello world\n")
    await writeFile(path.join(env.workspace, "README.md"), "# Hello\n")
    await writeFile(path.join(env.workspace, "node_modules/pkg/index.ts"), "hello\n")
  })

  it("finds files recursively and skips node_modules", async () => {
    expect((await fsFindTool.execute({ pattern: "**/*.ts" }, ctx())).result).toEqual({
      files: ["src/a.ts", "src/lib/b.ts"],
      total: 2,
      truncated: false,
    })
    expect((await fsFindTool.execute({ pattern: "*.ts", path: "src/lib" }, ctx())).result).toMatchObject({
      files: ["src/lib/b.ts"],
    })
    expect((await fsFindTool.execute({ path: "nope" }, ctx())).error).toMatch(/Not found/)
    expect((await fsFindTool.execute({ pattern: "../**" }, ctx())).error).toMatch(/inside the folder/)
    expect((await fsFindTool.execute({ pattern: "/etc/*" }, ctx())).error).toMatch(/inside the folder/)
  })

  it("searches text, ignoring case by default", async () => {
    const plain = await fsSearchTool.execute({ query: "hello" }, ctx())
    expect(plain.result).toEqual({
      matches: [
        { path: "README.md", line: 1, text: "# Hello" },
        { path: "src/a.ts", line: 2, text: "const Hello = 2" },
        { path: "src/lib/b.ts", line: 1, text: "hello world" },
      ],
      truncated: false,
    })
    const exact = await fsSearchTool.execute({ query: "hello", caseSensitive: true, glob: "**/*.ts" }, ctx())
    expect((exact.result as { matches: unknown[] }).matches).toHaveLength(1)
    const regex = await fsSearchTool.execute({ query: "^export\\s+const", regex: true }, ctx())
    expect((regex.result as { matches: Array<{ path: string }> }).matches.map((m) => m.path)).toEqual(["src/a.ts"])
    expect((await fsSearchTool.execute({ query: "(", regex: true }, ctx())).error).toMatch(/Invalid regular/)
    expect((await fsSearchTool.execute({ query: "a(" }, ctx())).error).toBeUndefined()
  })

  it("accepts `pattern` for the search text and names a missing field", async () => {
    const aliased = await fsSearchTool.execute({ pattern: "export", glob: "src/**/*.ts" }, ctx())
    expect(aliased.error).toBeUndefined()
    expect((aliased.result as { matches: Array<{ path: string }> }).matches.map((m) => m.path)).toEqual(["src/a.ts"])
    const both = await fsSearchTool.execute({ query: "world", pattern: "export" }, ctx())
    expect((both.result as { matches: Array<{ path: string }> }).matches.map((m) => m.path)).toEqual(["src/lib/b.ts"])
    expect((await fsSearchTool.execute({ glob: "**/*.ts" }, ctx())).error).toMatch(/^`query`: /)
    expect((await fsReadTool.execute({}, ctx())).error).toMatch(/^`path`: /)
  })

  it("edits exact text once, or everywhere with replaceAll", async () => {
    const file = path.join(env.workspace, "src/a.ts")
    expect((await fsEditTool.execute({ path: "src/a.ts", oldText: "= 1", newText: "= 10" }, ctx())).result).toEqual({
      path: "src/a.ts",
      replacements: 1,
    })
    expect(await readFile(file, "utf8")).toBe("export const a = 10\nconst Hello = 2\n")
    expect((await fsEditTool.execute({ path: "src/a.ts", oldText: "const", newText: "let" }, ctx())).error).toMatch(/2 times/)
    await fsEditTool.execute({ path: "src/a.ts", oldText: "const", newText: "let", replaceAll: true }, ctx())
    expect(await readFile(file, "utf8")).toBe("export let a = 10\nlet Hello = 2\n")
    await fsEditTool.execute({ path: "src/a.ts", oldText: "10", newText: "$&$&" }, ctx())
    expect(await readFile(file, "utf8")).toContain("a = $&$&")
  })

  it("rejects missing text, missing files and protected paths", async () => {
    expect((await fsEditTool.execute({ path: "src/a.ts", oldText: "nope", newText: "x" }, ctx())).error).toMatch(/not found/)
    expect((await fsEditTool.execute({ path: "new.ts", oldText: "a", newText: "b" }, ctx())).error).toMatch(/fs_write/)
    expect((await fsEditTool.execute({ path: ".git/config", oldText: "a", newText: "b" }, ctx())).error).toMatch(/not allowed/)
    expect((await fsEditTool.execute({ path: "src/a.ts", oldText: "", newText: "b" }, ctx())).error).toBeDefined()
    expect(fsEditTool.riskFor?.({ path: "src/a.ts" })).toBe("write")
    expect(fsEditTool.riskFor?.({ path: ".cursor/rules/x.mdc" })).toBe("exec")
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

  it("gives the generic assistant file writes and commands", () => {
    expect(ASSISTANT_TOOL_SCOPE.builtins).toEqual(["fs_list", "fs_read", "fs_write", "shell_run"])
    expect(builtinTools(ASSISTANT_TOOL_SCOPE.builtins).map((t) => t.name)).toEqual([
      "fs_list",
      "fs_read",
      "fs_find",
      "fs_search",
      "fs_write",
      "fs_edit",
      "shell_run",
    ])
  })

  it("adds the search tools to read access and fs_edit to write access", () => {
    expect(expandBuiltinTools(["fs_read"])).toEqual(["fs_read", "fs_find", "fs_search"])
    expect(expandBuiltinTools(["fs_write"])).toEqual(["fs_write", "fs_edit"])
    expect(expandBuiltinTools(["shell_run", "browser_run_flow"])).toEqual(["shell_run", "browser_run_flow"])
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
    expect(tools.map((t) => t.name)).toEqual(["fs_read", "fs_find", "fs_search"])
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
