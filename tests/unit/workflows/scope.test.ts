import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdir, readFile } from "node:fs/promises"

import { workflowSchema, type Workflow } from "@/lib/workflows/schema"
import {
  deleteWorkflow,
  listWorkflows,
  readWorkflow,
  saveWorkflow,
  workflowExists,
  workflowsDirRelPath,
} from "@/lib/workflows/store"
import { makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

function wf(name: string, task: string): Workflow {
  return workflowSchema.parse({ name, task, steps: [{ id: "one", agent: "demo" }] })
}

async function seedWorkspaceWorkflow(name: string, task: string): Promise<void> {
  await mkdir(`${env.workspace}/.black-agents/workflows`, { recursive: true })
  await seedArtifact(
    env.workspace,
    `.black-agents/workflows/${name}.workflow.json`,
    JSON.stringify(wf(name, task), null, 2)
  )
}

async function seedProjectWorkflow(project: string, name: string, task: string): Promise<void> {
  await mkdir(`${env.workspace}/.black-agents/projects/${project}/workflows`, { recursive: true })
  await seedArtifact(
    env.workspace,
    `.black-agents/projects/${project}/workflows/${name}.workflow.json`,
    JSON.stringify(wf(name, task), null, 2)
  )
}

describe("workflowsDirRelPath", () => {
  it("keeps scopes apart and rejects traversal", () => {
    expect(workflowsDirRelPath()).toBe(".black-agents/workflows")
    expect(workflowsDirRelPath("web")).toBe(".black-agents/projects/web/workflows")
    expect(() => workflowsDirRelPath("../..")).toThrow(/Invalid project id/)
  })
})

describe("listWorkflows in a scope", () => {
  it("workspace mode is unchanged", async () => {
    await seedWorkspaceWorkflow("ship", "workspace task")
    expect((await listWorkflows(env.workspace)).map((w) => w.name)).toEqual(["ship"])
  })

  it("always shows the project's own workflows, even without the token", async () => {
    await seedWorkspaceWorkflow("ship", "workspace task")
    await seedProject(env.workspace, "web", { inherits: [] })
    await seedProjectWorkflow("web", "deploy", "project task")
    const names = (await listWorkflows(env.workspace, "web")).map((w) => w.name)
    expect(names).toEqual(["deploy"])
  })

  it("merges the parent's workflows only when whitelisted, project wins on name", async () => {
    await seedWorkspaceWorkflow("ship", "workspace task")
    await seedWorkspaceWorkflow("shared", "workspace shared")
    await seedProject(env.workspace, "web", { inherits: ["workflows"] })
    await seedProjectWorkflow("web", "shared", "project shared")

    const scoped = await listWorkflows(env.workspace, "web")
    expect(scoped.map((w) => w.name)).toEqual(["shared", "ship"])
    expect(scoped.find((w) => w.name === "shared")?.task).toBe("project shared")
    expect(scoped.find((w) => w.name === "ship")?.task).toBe("workspace task")
  })

  it("fails closed to project files only for an invalid manifest", async () => {
    await seedWorkspaceWorkflow("ship", "workspace task")
    await seedProject(env.workspace, "web", { inherits: ["workflows"] })
    await seedProjectWorkflow("web", "deploy", "project task")
    // Corrupt: id/folder mismatch → inherits nothing.
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/web/project.json",
      JSON.stringify({ id: "mismatch", inherits: ["workflows"] }, null, 2)
    )
    const names = (await listWorkflows(env.workspace, "web")).map((w) => w.name)
    expect(names).toEqual(["deploy"])
  })
})

describe("readWorkflow in a scope", () => {
  it("prefers the project's own file over an inherited one", async () => {
    await seedWorkspaceWorkflow("shared", "workspace shared")
    await seedProject(env.workspace, "web", { inherits: ["workflows"] })
    await seedProjectWorkflow("web", "shared", "project shared")
    const read = await readWorkflow(env.workspace, "shared", "web")
    expect(read?.task).toBe("project shared")
  })

  it("does not read parent files without the token", async () => {
    await seedWorkspaceWorkflow("ship", "workspace task")
    await seedProject(env.workspace, "web", { inherits: ["rules"] })
    expect(await readWorkflow(env.workspace, "ship", "web")).toBeNull()
  })

  it("workspace mode is unchanged", async () => {
    await seedWorkspaceWorkflow("ship", "workspace task")
    expect((await readWorkflow(env.workspace, "ship"))?.task).toBe("workspace task")
    expect(await readWorkflow(env.workspace, "missing")).toBeNull()
  })
})

describe("scoped workflow writes", () => {
  it("saveWorkflow writes into the project folder, leaving the parent file alone", async () => {
    await seedWorkspaceWorkflow("shared", "workspace shared")
    await seedProject(env.workspace, "web", { inherits: ["workflows"] })
    await saveWorkflow(env.workspace, wf("shared", "project shared"), "web")

    const onDisk = JSON.parse(
      await readFile(
        `${env.workspace}/.black-agents/projects/web/workflows/shared.workflow.json`,
        "utf8"
      )
    ) as { task: string }
    expect(onDisk.task).toBe("project shared")
    const parentRaw = JSON.parse(
      await readFile(`${env.workspace}/.black-agents/workflows/shared.workflow.json`, "utf8")
    ) as { task: string }
    expect(parentRaw.task).toBe("workspace shared")
  })

  it("scoped delete removes only the project's own file", async () => {
    await seedWorkspaceWorkflow("shared", "workspace shared")
    await seedProject(env.workspace, "web", { inherits: ["workflows"] })
    await seedProjectWorkflow("web", "shared", "project shared")
    await seedProjectWorkflow("web", "deploy", "project task")

    expect(await deleteWorkflow(env.workspace, "shared", "web")).toBe(true)
    // The parent's copy is untouched and visible again through inheritance.
    expect((await readWorkflow(env.workspace, "shared", "web"))?.task).toBe("workspace shared")
    // Deleting a name the project does not own is a no-op.
    expect(await deleteWorkflow(env.workspace, "ship", "web")).toBe(false)
    expect(await deleteWorkflow(env.workspace, "deploy", "web")).toBe(true)
  })

  it("workflowExists respects the whitelist", async () => {
    await seedWorkspaceWorkflow("ship", "workspace task")
    await seedProject(env.workspace, "web", { inherits: ["rules"] })
    expect(await workflowExists(env.workspace, "ship", "web")).toBe(false)
    await seedProject(env.workspace, "other", { inherits: ["workflows"] })
    expect(await workflowExists(env.workspace, "ship", "other")).toBe(true)
    expect(await workflowExists(env.workspace, "ship")).toBe(true)
  })

  it("traversal scopes cannot write outside the workspace", async () => {
    await expect(saveWorkflow(env.workspace, wf("ship", "t"), "../../escape")).rejects.toThrow(
      /Invalid project id/
    )
  })
})
