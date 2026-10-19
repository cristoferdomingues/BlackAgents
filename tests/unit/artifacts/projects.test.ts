import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdir, readFile, writeFile } from "node:fs/promises"

import {
  PROJECTS_DIR,
  ProjectError,
  createProject,
  deleteProject,
  inheritsScopeToken,
  listProjects,
  listProjectsDetailed,
  loadProjectScope,
  projectDirRelPath,
  projectManifestRelPath,
  saveProjectManifest,
} from "@/lib/artifacts/projects"
import {
  projectIdSchema,
  projectManifestSchema,
  scopeTokenSchema,
} from "@/lib/artifacts/schemas"
import { makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

/** Raw manifest writer — lets tests write deliberately invalid JSON. */
async function writeRawManifest(id: string, raw: string): Promise<void> {
  const rel = `${PROJECTS_DIR}/${id}/project.json`
  const abs = `${env.workspace}/${rel}`
  await mkdir(`${env.workspace}/${PROJECTS_DIR}/${id}`, { recursive: true })
  await writeFile(abs, raw, "utf8")
}

describe("scope token + id schemas", () => {
  it("accepts exactly the seven inheritable tokens", () => {
    for (const token of ["mcp", "skills", "rules", "commands", "agents", "workflows", "knowledge"]) {
      expect(scopeTokenSchema.safeParse(token).success).toBe(true)
    }
  })

  it("rejects unknown tokens (the set is closed)", () => {
    for (const bad of ["files", "MCP", "brain", "secrets", ""]) {
      expect(scopeTokenSchema.safeParse(bad).success).toBe(false)
    }
  })

  it("accepts kebab-case single-segment project ids", () => {
    for (const id of ["web", "crypto-bot", "a1", "a-1-b"]) {
      expect(projectIdSchema.safeParse(id).success).toBe(true)
    }
  })

  it("rejects traversal, separators and non-kebab ids", () => {
    for (const bad of ["..", "../evil", "a/b", "a\\b", "Web", "up_", "-lead", "trail-", "a--b", ""]) {
      expect(projectIdSchema.safeParse(bad).success).toBe(false)
    }
  })

  it("manifest schema defaults inherits to []", () => {
    const parsed = projectManifestSchema.parse({ id: "web" })
    expect(parsed.inherits).toEqual([])
  })

  it("manifest schema rejects an unknown inherit token", () => {
    expect(projectManifestSchema.safeParse({ id: "web", inherits: ["brain"] }).success).toBe(false)
  })
})

describe("loadProjectScope", () => {
  it("loads a valid manifest, defaulting name to the id", async () => {
    await seedProject(env.workspace, "crypto-bot", {
      description: "Crypto work",
      inherits: ["rules", "skills"],
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    const loaded = await loadProjectScope(env.workspace, "crypto-bot")
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.project).toEqual({
      id: "crypto-bot",
      name: "crypto-bot",
      description: "Crypto work",
      inherits: ["rules", "skills"],
      createdAt: "2026-01-01T00:00:00.000Z",
      manifestRelPath: ".black-agents/projects/crypto-bot/project.json",
    })
  })

  it("fails closed on an unknown inherit token", async () => {
    await seedProject(env.workspace, "web", { inherits: ["rules", "files"] })
    const loaded = await loadProjectScope(env.workspace, "web")
    expect(loaded.ok).toBe(false)
  })

  it("fails closed when the manifest id does not equal the folder name", async () => {
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/actual/project.json",
      JSON.stringify({ id: "other", inherits: [] }, null, 2)
    )
    const loaded = await loadProjectScope(env.workspace, "actual")
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.error).toMatch(/must equal the folder name/)
  })

  it("fails closed on a missing manifest", async () => {
    const loaded = await loadProjectScope(env.workspace, "ghost")
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.error).toMatch(/Missing/)
  })

  it("fails closed on invalid JSON", async () => {
    await writeRawManifest("web", "NOT_JSON{{")
    const loaded = await loadProjectScope(env.workspace, "web")
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.error).toMatch(/Invalid JSON/)
  })

  it("fails closed on an invalid id (no traversal out of projects/)", async () => {
    for (const id of ["..", "../..", "a/b", "UPPER"]) {
      const loaded = await loadProjectScope(env.workspace, id)
      expect(loaded.ok).toBe(false)
    }
  })

  it("rejects a project that holds a nested projects folder", async () => {
    await seedProject(env.workspace, "outer")
    await seedProject(env.workspace, "outer/projects/inner")
    const loaded = await loadProjectScope(env.workspace, "outer")
    expect(loaded.ok).toBe(false)
    if (loaded.ok) return
    expect(loaded.error).toMatch(/Nested projects are not allowed/)
    const detailed = await listProjectsDetailed(env.workspace)
    expect(detailed.invalid.map((p) => p.folder)).toEqual(["outer"])
  })

  it("reports a non-object manifest as invalid", async () => {
    await writeRawManifest("web", JSON.stringify(["not", "an", "object"]))
    const loaded = await loadProjectScope(env.workspace, "web")
    expect(loaded.ok).toBe(false)
  })
})

describe("listProjects / listProjectsDetailed", () => {
  it("lists nothing when the projects folder is absent", async () => {
    expect(await listProjects(env.workspace)).toEqual([])
    expect(await listProjectsDetailed(env.workspace)).toEqual({ projects: [], invalid: [] })
  })

  it("lists valid projects sorted by name and skips broken folders", async () => {
    await seedProject(env.workspace, "zeta", { name: "Zeta" })
    await seedProject(env.workspace, "alpha", { name: "Alpha" })
    await writeRawManifest("broken", "{ nope")
    await seedArtifact(env.workspace, `${PROJECTS_DIR}/just-a-file.txt`, "not a project")

    const listed = await listProjects(env.workspace)
    expect(listed.map((p) => p.id)).toEqual(["alpha", "zeta"])

    const detailed = await listProjectsDetailed(env.workspace)
    expect(detailed.projects.map((p) => p.id)).toEqual(["alpha", "zeta"])
    expect(detailed.invalid).toHaveLength(1)
    expect(detailed.invalid[0]?.folder).toBe("broken")
    expect(detailed.invalid[0]?.error).toMatch(/Invalid JSON/)
  })

  it("is depth-1 only: nested project folders are never scopes", async () => {
    await seedProject(env.workspace, "outer")
    // outer/inner looks like a project but lives one level too deep.
    await seedProject(env.workspace, "outer/inner")
    // Even loading it directly by any crafted id fails: only depth-1 ids resolve.
    const listed = await listProjects(env.workspace)
    expect(listed.map((p) => p.id)).toEqual(["outer"])
    const nested = await loadProjectScope(env.workspace, "outer/inner")
    expect(nested.ok).toBe(false)
  })
})

describe("inheritsScopeToken", () => {
  it("is true in workspace mode (the workspace owns everything)", async () => {
    expect(await inheritsScopeToken(env.workspace, undefined, "knowledge")).toBe(true)
  })

  it("is true only for whitelisted tokens", async () => {
    await seedProject(env.workspace, "web", { inherits: ["mcp"] })
    expect(await inheritsScopeToken(env.workspace, "web", "mcp")).toBe(true)
    expect(await inheritsScopeToken(env.workspace, "web", "knowledge")).toBe(false)
  })

  it("fails closed for a project that does not load", async () => {
    // A crafted folder whose manifest id mismatches the folder inherits nothing,
    // regardless of what tokens the file asks for.
    const id = await seedProjectThenCorrupt()
    expect(await inheritsScopeToken(env.workspace, id, "mcp")).toBe(false)
    expect(await inheritsScopeToken(env.workspace, "does-not-exist", "mcp")).toBe(false)
  })
})

async function seedProjectThenCorrupt(): Promise<string> {
  await seedArtifact(
    env.workspace,
    ".black-agents/projects/sneaky/project.json",
    JSON.stringify({ id: "mismatched", inherits: ["mcp"] }, null, 2)
  )
  return "sneaky"
}

describe("createProject / saveProjectManifest / deleteProject", () => {
  it("creates a project folder + manifest that loads back", async () => {
    const created = await createProject(env.workspace, {
      id: "crypto-bot",
      name: "Crypto bot",
      inherits: ["skills"],
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    expect(created.id).toBe("crypto-bot")
    const onDisk = JSON.parse(
      await readFile(`${env.workspace}/${projectManifestRelPath("crypto-bot")}`, "utf8")
    ) as Record<string, unknown>
    expect(onDisk).toMatchObject({ id: "crypto-bot", inherits: ["skills"] })
    expect((await loadProjectScope(env.workspace, "crypto-bot")).ok).toBe(true)
  })

  it("rejects a duplicate id with 409", async () => {
    await createProject(env.workspace, { id: "web", inherits: [] })
    await expect(createProject(env.workspace, { id: "web", inherits: [] })).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      createProject(env.workspace, { id: "web", inherits: [] })
    ).rejects.toBeInstanceOf(ProjectError)
  })

  it("updates the whitelist without touching the folder id", async () => {
    await createProject(env.workspace, { id: "web", inherits: [] })
    const saved = await saveProjectManifest(env.workspace, {
      id: "web",
      name: "Web",
      inherits: ["rules"],
    })
    expect(saved.inherits).toEqual(["rules"])
    expect(saved.name).toBe("Web")
    expect(await listProjects(env.workspace)).toHaveLength(1)
  })

  it("saveProjectManifest 404s on a project that does not exist", async () => {
    await expect(
      saveProjectManifest(env.workspace, { id: "ghost", inherits: [] })
    ).rejects.toMatchObject({ status: 404 })
  })

  it("deletes the whole project folder, and reports a miss", async () => {
    await createProject(env.workspace, { id: "web", inherits: [] })
    expect(await deleteProject(env.workspace, "web")).toBe(true)
    expect(await loadProjectScope(env.workspace, "web")).toMatchObject({ ok: false })
    expect(await deleteProject(env.workspace, "web")).toBe(false)
    // Invalid ids never delete anything.
    expect(await deleteProject(env.workspace, "../..")).toBe(false)
  })
})

describe("path helpers", () => {
  it("builds depth-1 project paths", () => {
    expect(projectDirRelPath("web")).toBe(".black-agents/projects/web")
    expect(projectManifestRelPath("web")).toBe(".black-agents/projects/web/project.json")
  })

  it("throws on invalid ids instead of building a traversal path", () => {
    expect(() => projectDirRelPath("../..")).toThrow(/Invalid project id/)
    expect(() => projectManifestRelPath("a/b")).toThrow(/Invalid project id/)
  })
})
