import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  deleteScopedMcpServer,
  mcpConfigRelPath,
  projectMcpConfigRelPath,
  readScopedMcpConfig,
  saveScopedMcpServer,
  writeProjectMcpConfig,
  writeWorkspaceMcpConfig,
} from "@/lib/mcp/config"
import { mcpServerConfigSchema, type McpServerConfig } from "@/lib/mcp/types"
import { makeTempEnv, seedProject, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const stdio = (args: string[]): McpServerConfig => mcpServerConfigSchema.parse({ command: "uvx", args })
const http = (url: string): McpServerConfig => mcpServerConfigSchema.parse({ url })

describe("readScopedMcpConfig — workspace mode", () => {
  it("returns the workspace config with workspace origins", async () => {
    await writeWorkspaceMcpConfig(env.workspace, {
      mcpServers: { sqlite: stdio(["sqlite-mcp"]) },
    })
    const view = await readScopedMcpConfig(env.workspace)
    expect(Object.keys(view.config.mcpServers)).toEqual(["sqlite"])
    expect(view.origins).toEqual({ sqlite: "workspace" })
  })
})

describe("readScopedMcpConfig — merge order", () => {
  it("project servers win on name; whitelisted workspace servers fill in beneath", async () => {
    await writeWorkspaceMcpConfig(env.workspace, {
      mcpServers: { shared: stdio(["from-workspace"]), onlyWorkspace: http("https://w.example/mcp") },
    })
    await seedProject(env.workspace, "web", { inherits: ["mcp"] })
    await writeProjectMcpConfig(env.workspace, "web", {
      mcpServers: { shared: stdio(["from-project"]), onlyProject: http("https://p.example/mcp") },
    })

    const view = await readScopedMcpConfig(env.workspace, "web")
    expect(Object.keys(view.config.mcpServers).sort()).toEqual([
      "onlyProject",
      "onlyWorkspace",
      "shared",
    ])
    expect(view.config.mcpServers.shared?.args).toEqual(["from-project"])
    expect(view.origins).toEqual({
      shared: "project",
      onlyProject: "project",
      onlyWorkspace: "workspace",
    })
  })

  it("project-only view when the mcp token is not whitelisted (fail closed)", async () => {
    await writeWorkspaceMcpConfig(env.workspace, {
      mcpServers: { onlyWorkspace: http("https://w.example/mcp") },
    })
    await seedProject(env.workspace, "web", { inherits: ["rules"] })
    await writeProjectMcpConfig(env.workspace, "web", {
      mcpServers: { onlyProject: http("https://p.example/mcp") },
    })

    const view = await readScopedMcpConfig(env.workspace, "web")
    expect(Object.keys(view.config.mcpServers)).toEqual(["onlyProject"])
    expect(view.origins).toEqual({ onlyProject: "project" })
  })

  it("a project that does not load sees no servers at all", async () => {
    await writeWorkspaceMcpConfig(env.workspace, {
      mcpServers: { shared: stdio(["from-workspace"]) },
    })
    // Folder without a manifest: invalid project → empty view.
    const view = await readScopedMcpConfig(env.workspace, "ghost")
    expect(view).toEqual({ config: { mcpServers: {} }, origins: {} })
  })

  it("an unknown token invalidates the manifest, so nothing inherits", async () => {
    await writeWorkspaceMcpConfig(env.workspace, {
      mcpServers: { shared: stdio(["from-workspace"]) },
    })
    await seedProject(env.workspace, "web", { inherits: ["mcp", "files"] })
    const view = await readScopedMcpConfig(env.workspace, "web")
    expect(view).toEqual({ config: { mcpServers: {} }, origins: {} })
  })
})

describe("scoped MCP writes", () => {
  it("saveScopedMcpServer writes to the project file, not the workspace file", async () => {
    await seedProject(env.workspace, "web", { inherits: [] })
    await saveScopedMcpServer(env.workspace, "proj-db", stdio(["sqlite"]), "web")

    const projectRaw = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(`${env.workspace}/${projectMcpConfigRelPath("web")}`, "utf8")
    ) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(projectRaw.mcpServers)).toEqual(["proj-db"])

    const workspaceView = await readScopedMcpConfig(env.workspace)
    expect(workspaceView.config.mcpServers["proj-db"]).toBeUndefined()
  })

  it("deleting an inherited server leaves the workspace file untouched", async () => {
    await writeWorkspaceMcpConfig(env.workspace, { mcpServers: { shared: stdio(["s"]) } })
    await seedProject(env.workspace, "web", { inherits: ["mcp"] })

    const after = await deleteScopedMcpServer(env.workspace, "shared", "web")
    // Still visible through inheritance — the parent file was not mutated.
    expect(Object.keys(after.mcpServers)).toEqual(["shared"])
    const workspaceView = await readScopedMcpConfig(env.workspace)
    expect(Object.keys(workspaceView.config.mcpServers)).toEqual(["shared"])
  })

  it("deleting a project's own server removes it from the merged view", async () => {
    await writeWorkspaceMcpConfig(env.workspace, { mcpServers: { shared: stdio(["s"]) } })
    await seedProject(env.workspace, "web", { inherits: ["mcp"] })
    await saveScopedMcpServer(env.workspace, "mine", http("https://p.example/mcp"), "web")

    const after = await deleteScopedMcpServer(env.workspace, "mine", "web")
    expect(Object.keys(after.mcpServers).sort()).toEqual(["shared"])
  })

  it("workspace deletes still work without a scope", async () => {
    await writeWorkspaceMcpConfig(env.workspace, {
      mcpServers: { keep: stdio(["k"]), drop: stdio(["d"]) },
    })
    const after = await deleteScopedMcpServer(env.workspace, "drop")
    expect(Object.keys(after.mcpServers)).toEqual(["keep"])
  })

  it("writeProjectMcpConfig refuses an unloadable project", async () => {
    await expect(
      writeProjectMcpConfig(env.workspace, "ghost", { mcpServers: {} })
    ).rejects.toThrow(/Missing/)
  })

  it("path helpers keep workspace and project files apart", () => {
    expect(mcpConfigRelPath()).toBe(".black-agents/mcp.json")
    expect(mcpConfigRelPath("web")).toBe(".black-agents/projects/web/mcp.json")
    expect(() => mcpConfigRelPath("../..")).toThrow(/Invalid project id/)
  })
})
