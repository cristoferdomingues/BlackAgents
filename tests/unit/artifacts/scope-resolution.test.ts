import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { findArtifact, scanSource, scanWorkspace } from "@/lib/artifacts/parser"
import { sourceRoot } from "@/lib/artifacts/source"
import {
  ArtifactStoreError,
  createArtifact,
  deleteArtifact,
  updateArtifact,
} from "@/lib/artifacts/store"
import { makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const agentMd = (description: string): string =>
  `---\nname: demo\ndescription: ${description}\n---\n\n## Input\n\n- x\n`

const ruleMd = (description: string): string =>
  `---\ndescription: ${description}\n---\n\n- do the thing\n`

const skillMd = (title: string): string =>
  `---\nname: demo-skill\ndescription: ${title}\n---\n\n# Skill\n`

const commandMd = (description: string): string =>
  `---\ndescription: ${description}\n---\n\nRun it.\n`

/** Workspace source + project source + a manifest with the given whitelist. */
async function seedScope(inherits: string[]): Promise<void> {
  await seedArtifact(env.workspace, ".black-agents/artifacts/agents/demo.md", agentMd("workspace agent"))
  await seedArtifact(env.workspace, ".black-agents/artifacts/rules/shared.md", ruleMd("workspace rule"))
  await seedArtifact(env.workspace, ".black-agents/artifacts/skills/demo-skill/SKILL.md", skillMd("workspace skill"))
  await seedArtifact(env.workspace, ".black-agents/artifacts/commands/go.md", commandMd("workspace command"))

  await seedArtifact(env.workspace, ".black-agents/projects/web/artifacts/agents/demo.md", agentMd("project agent"))
  await seedArtifact(env.workspace, ".black-agents/projects/web/artifacts/rules/project-only.md", ruleMd("project rule"))
  await seedProject(env.workspace, "web", { inherits })
}

function byTypeAndName(list: Array<{ type: string; name: string }>): string[] {
  return list.map((a) => `${a.type}:${a.name}`).sort()
}

describe("scanSource", () => {
  it("tags every artifact with the project scope when scanning a scope", async () => {
    await seedScope([])
    const scoped = await scanSource(env.workspace, "web")
    expect(scoped.length).toBeGreaterThan(0)
    for (const artifact of scoped) {
      expect(artifact.scope).toEqual({ project: "web" })
      expect(artifact.relativePath).toMatch(/^\.black-agents\/projects\/web\/artifacts\//)
    }
  })

  it("leaves workspace artifacts scope-less (byte-identical default paths)", async () => {
    await seedScope([])
    const workspace = await scanSource(env.workspace)
    expect(workspace.every((a) => a.scope === undefined)).toBe(true)
    const rule = workspace.find((a) => a.type === "rule")
    expect(rule?.relativePath).toBe(".black-agents/artifacts/rules/shared.md")
  })

  it("throws instead of building a path for a traversal scope", async () => {
    await expect(scanSource(env.workspace, "../..")).rejects.toThrow(/Invalid project id/)
    await expect(scanSource(env.workspace, "a/b")).rejects.toThrow(/Invalid project id/)
    expect(() => sourceRoot(undefined)).not.toThrow()
  })
})

describe("scanWorkspace with a scope — resolution order", () => {
  it("without a scope keeps today's behavior (workspace source, then IDE)", async () => {
    await seedScope([])
    const all = await scanWorkspace(env.workspace)
    // No project contributions in workspace mode.
    expect(byTypeAndName(all)).toEqual(["agent:demo", "command:go", "rule:shared", "skill:demo-skill"])
  })

  it("always shows the project's own artifacts, even with an empty whitelist", async () => {
    await seedScope([])
    const all = await scanWorkspace(env.workspace, "web")
    expect(byTypeAndName(all)).toEqual(["agent:demo", "rule:project-only"])
    const agent = all.find((a) => a.type === "agent")
    expect(agent?.description).toBe("project agent")
    expect(agent?.scope).toEqual({ project: "web" })
  })

  it("project entry beats the workspace copy on a type+name collision", async () => {
    await seedScope(["agents", "rules"])
    const all = await scanWorkspace(env.workspace, "web")
    const agent = all.find((a) => a.type === "agent")
    expect(agent?.description).toBe("project agent")
    expect(agent?.scope).toEqual({ project: "web" })
    // The workspace rule is inherited alongside the project's own rule.
    const ruleNames = all.filter((a) => a.type === "rule").map((a) => a.name)
    expect(ruleNames.sort()).toEqual(["project-only", "shared"])
  })

  it("gates each type by its whitelisted token", async () => {
    await seedScope(["rules", "skills"])
    const all = await scanWorkspace(env.workspace, "web")
    const types = new Set(all.map((a) => a.type))
    expect(types).toEqual(new Set(["agent", "rule", "skill"]))
    // agent and command exist in the workspace source but are NOT whitelisted.
    const agent = all.find((a) => a.type === "agent")
    expect(agent?.scope).toEqual({ project: "web" }) // the project's own one only
    expect(all.filter((a) => a.type === "command")).toEqual([])
  })

  it("shows the workspace skill only through the skills token", async () => {
    await seedScope(["skills"])
    const all = await scanWorkspace(env.workspace, "web")
    const skill = all.find((a) => a.type === "skill")
    expect(skill?.name).toBe("demo-skill")
    expect(skill?.scope).toBeUndefined() // inherited entries stay scope-less
    expect(skill?.relativePath).toBe(".black-agents/artifacts/skills/demo-skill/SKILL.md")
  })
})

describe("scanWorkspace with a scope — fail closed", () => {
  it("an invalid manifest inherits nothing (project files only)", async () => {
    await seedScope(["agents", "rules", "skills", "commands"])
    // Corrupt the manifest after seeding: the whitelist must vanish entirely.
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/web/project.json",
      JSON.stringify({ id: "mismatch", inherits: ["agents", "rules", "skills", "commands"] }, null, 2)
    )
    const all = await scanWorkspace(env.workspace, "web")
    expect(byTypeAndName(all)).toEqual(["agent:demo", "rule:project-only"])
  })

  it("an unknown token in the manifest invalidates the whole whitelist", async () => {
    await seedArtifact(env.workspace, ".black-agents/artifacts/rules/shared.md", ruleMd("workspace rule"))
    await seedArtifact(env.workspace, ".black-agents/projects/web/artifacts/rules/project-only.md", ruleMd("project rule"))
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/web/project.json",
      JSON.stringify({ id: "web", inherits: ["rules", "files"] }, null, 2)
    )
    const all = await scanWorkspace(env.workspace, "web")
    expect(byTypeAndName(all)).toEqual(["rule:project-only"])
  })

  it("a missing manifest inherits nothing", async () => {
    await seedArtifact(env.workspace, ".black-agents/artifacts/rules/shared.md", ruleMd("workspace rule"))
    await seedArtifact(env.workspace, ".black-agents/projects/web/artifacts/agents/demo.md", agentMd("project agent"))
    const all = await scanWorkspace(env.workspace, "web")
    expect(byTypeAndName(all)).toEqual(["agent:demo"])
  })

  it("findArtifact resolves through the scope", async () => {
    await seedScope(["agents"])
    const own = await findArtifact(env.workspace, "agent", "demo", "web")
    expect(own?.description).toBe("project agent")
    const inherited = await findArtifact(env.workspace, "rule", "shared", "web")
    expect(inherited).toBeNull() // rules are not whitelisted here
  })
})

describe("scoped store writes", () => {
  const input = {
    type: "agent" as const,
    platform: "cursor" as const,
    name: "fresh",
    description: "A fresh agent.",
    body: "## Input\n\n- y\n",
    extra: {},
  }

  it("createArtifact writes into the project tree and never exports to IDE folders", async () => {
    await seedProject(env.workspace, "web", { inherits: [] })
    const saved = await createArtifact(env.workspace, input, "web")
    expect(saved.scope).toEqual({ project: "web" })
    expect(saved.relativePath).toBe(".black-agents/projects/web/artifacts/agents/fresh.md")
    // No IDE copy was created for a scoped save.
    await expect(
      import("node:fs/promises").then((fs) =>
        fs.stat(`${env.workspace}/.cursor/agents/fresh.md`)
      )
    ).rejects.toThrow()
  })

  it("creating over an inherited name is an allowed override, but not over a project-local one", async () => {
    await seedScope([])
    // "demo" exists in both the workspace source and the project tree.
    const clash = { ...input, name: "demo" }
    await expect(createArtifact(env.workspace, clash, "web")).rejects.toBeInstanceOf(ArtifactStoreError)
    // "shared" is workspace-only: the project may shadow it.
    const override = {
      type: "rule" as const,
      platform: "cursor" as const,
      name: "shared",
      description: "Project override.",
      body: "- override\n",
      extra: {},
    }
    const saved = await createArtifact(env.workspace, override, "web")
    expect(saved.relativePath).toBe(".black-agents/projects/web/artifacts/rules/shared.md")
    const merged = await scanWorkspace(env.workspace, "web")
    expect(merged.find((a) => a.type === "rule" && a.name === "shared")?.body).toContain("override")
  })

  it("updateArtifact on an inherited artifact is 403 — a child never mutates its parent", async () => {
    await seedScope(["rules"])
    const update = {
      type: "rule" as const,
      platform: "cursor" as const,
      name: "shared",
      description: "Hacked.",
      body: "- hacked\n",
      extra: {},
    }
    await expect(updateArtifact(env.workspace, "shared", update, "web")).rejects.toMatchObject({
      status: 403,
    })
    // The workspace copy is untouched.
    const workspaceCopy = await findArtifact(env.workspace, "rule", "shared")
    expect(workspaceCopy?.body).toContain("do the thing")
  })

  it("updateArtifact works on the project's own artifact", async () => {
    await seedScope([])
    const update = {
      type: "rule" as const,
      platform: "cursor" as const,
      name: "project-only",
      description: "Updated.",
      body: "- updated\n",
      extra: {},
    }
    const saved = await updateArtifact(env.workspace, "project-only", update, "web")
    expect(saved.description).toBe("Updated.")
    expect(saved.relativePath).toBe(".black-agents/projects/web/artifacts/rules/project-only.md")
  })

  it("deleteArtifact removes only the project copy — inherited artifacts are 403", async () => {
    await seedScope(["rules"])
    await expect(deleteArtifact(env.workspace, "rule", "shared", "web")).rejects.toMatchObject({
      status: 403,
    })
    await deleteArtifact(env.workspace, "rule", "project-only", "web")
    const remaining = await scanWorkspace(env.workspace, "web")
    expect(remaining.find((a) => a.name === "project-only")).toBeUndefined()
    expect(remaining.find((a) => a.name === "shared")).toBeDefined()
  })

  it("confines scoped writes to the workspace (traversal scope cannot escape)", async () => {
    await seedProject(env.workspace, "web", { inherits: [] })
    await expect(createArtifact(env.workspace, input, "../../escape")).rejects.toThrow(
      /Invalid project id/
    )
  })
})
