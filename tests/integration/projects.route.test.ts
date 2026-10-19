import { access, readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GET as listProjects, POST as createProject } from "@/app/api/projects/route"
import {
  DELETE as deleteProject,
  GET as getProject,
  PATCH as patchProject,
} from "@/app/api/projects/[id]/route"
import { GET as getActive, PUT as putActive } from "@/app/api/projects/active/route"
import { GET as listArtifacts, POST as createArtifact } from "@/app/api/artifacts/route"
import {
  DELETE as deleteArtifact,
  GET as getArtifact,
  PUT as putArtifact,
} from "@/app/api/artifacts/[type]/[name]/route"
import { jsonRequest, makeTempEnv, seedArtifact, seedProject, type TempEnv } from "../helpers/workspace"

let env: TempEnv
beforeEach(async () => {
  env = await makeTempEnv()
})
afterEach(async () => {
  await env.cleanup()
})

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) })
const artifactCtx = (type: string, name: string) => ({ params: Promise.resolve({ type, name }) })

const rule = (name: string, body = "- Keep it short.\n") => ({
  type: "rule",
  platform: "cursor",
  name,
  description: `${name} rule.`,
  body,
  extra: {},
})

async function exists(rel: string): Promise<boolean> {
  try {
    await access(path.join(env.workspace, rel))
    return true
  } catch {
    return false
  }
}

describe("/api/projects CRUD", () => {
  it("creates, lists, reads, updates and deletes a project", async () => {
    const created = await createProject(
      jsonRequest("http://t/api/projects", "POST", {
        id: "health",
        name: "MyHealthCare",
        inherits: ["rules"],
      })
    )
    expect(created.status).toBe(201)
    const createdJson = await created.json()
    expect(createdJson.data).toMatchObject({ id: "health", name: "MyHealthCare", inherits: ["rules"] })
    expect(typeof createdJson.data.createdAt).toBe("string")
    expect(await exists(".black-agents/projects/health/project.json")).toBe(true)

    const listed = await (await listProjects()).json()
    expect(listed.data.projects.map((p: { id: string }) => p.id)).toEqual(["health"])
    expect(listed.data.activeProject).toBeNull()

    const one = await getProject(new Request("http://t/api/projects/health"), idCtx("health"))
    expect((await one.json()).data.name).toBe("MyHealthCare")

    const patched = await patchProject(
      jsonRequest("http://t/api/projects/health", "PATCH", { inherits: ["rules", "skills"] }),
      idCtx("health")
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).data.inherits).toEqual(["rules", "skills"])
    const manifest = JSON.parse(
      await readFile(path.join(env.workspace, ".black-agents/projects/health/project.json"), "utf8")
    ) as { id: string; createdAt?: string }
    expect(manifest.id).toBe("health")
    expect(manifest.createdAt).toBe(createdJson.data.createdAt)

    const removed = await deleteProject(new Request("http://t/api/projects/health"), idCtx("health"))
    expect(removed.status).toBe(200)
    expect(await exists(".black-agents/projects/health")).toBe(false)
  })

  it("rejects bad input: traversal ids, unknown tokens, duplicates", async () => {
    const traversal = await createProject(
      jsonRequest("http://t/api/projects", "POST", { id: "../escape" })
    )
    expect(traversal.status).toBe(400)

    const unknown = await createProject(
      jsonRequest("http://t/api/projects", "POST", { id: "web", inherits: ["brain"] })
    )
    expect(unknown.status).toBe(400)

    await createProject(jsonRequest("http://t/api/projects", "POST", { id: "web" }))
    const duplicate = await createProject(jsonRequest("http://t/api/projects", "POST", { id: "web" }))
    expect(duplicate.status).toBe(409)

    const badPatch = await patchProject(
      jsonRequest("http://t/api/projects/web", "PATCH", { inherits: ["secrets"] }),
      idCtx("web")
    )
    expect(badPatch.status).toBe(400)
  })

  it("lists broken folders separately instead of loading them", async () => {
    await seedProject(env.workspace, "good")
    await seedArtifact(
      env.workspace,
      ".black-agents/projects/bad/project.json",
      JSON.stringify({ id: "other" })
    )
    const json = await (await listProjects()).json()
    expect(json.data.projects.map((p: { id: string }) => p.id)).toEqual(["good"])
    expect(json.data.invalid).toEqual([
      expect.objectContaining({ folder: "bad", error: expect.stringMatching(/folder name/) }),
    ])
    const missing = await getProject(new Request("http://t/api/projects/bad"), idCtx("bad"))
    expect(missing.status).toBe(404)
  })
})

describe("/api/projects/active", () => {
  it("activates a valid project and clears it with null", async () => {
    await seedProject(env.workspace, "web")
    const set = await putActive(jsonRequest("http://t/api/projects/active", "PUT", { id: "web" }))
    expect((await set.json()).data.activeProject).toBe("web")
    expect((await (await getActive()).json()).data.activeProject).toBe("web")

    const cleared = await putActive(jsonRequest("http://t/api/projects/active", "PUT", { id: null }))
    expect((await cleared.json()).data.activeProject).toBeNull()
  })

  it("refuses a project that does not load (fail closed)", async () => {
    const res = await putActive(jsonRequest("http://t/api/projects/active", "PUT", { id: "ghost" }))
    expect(res.status).toBe(404)
    const bad = await putActive(jsonRequest("http://t/api/projects/active", "PUT", { id: "../x" }))
    expect(bad.status).toBe(400)
  })
})

describe("/api/artifacts with ?scope", () => {
  beforeEach(async () => {
    await createArtifact(jsonRequest("http://t/api/artifacts", "POST", rule("shared")))
    await createArtifact(jsonRequest("http://t/api/artifacts", "POST", rule("workspace-only")))
  })

  it("shows inherited artifacts only for whitelisted tokens", async () => {
    await seedProject(env.workspace, "web", { inherits: ["rules"] })
    await seedProject(env.workspace, "closed", { inherits: ["skills"] })

    const web = await (await listArtifacts(new Request("http://t/api/artifacts?scope=web"))).json()
    expect(web.data.map((a: { name: string }) => a.name).sort()).toEqual(["shared", "workspace-only"])
    expect(web.data.every((a: { scope?: unknown }) => a.scope === undefined)).toBe(true)

    const closed = await (await listArtifacts(new Request("http://t/api/artifacts?scope=closed"))).json()
    expect(closed.data).toEqual([])
  })

  it("writes land inside the project folder and win over the inherited copy", async () => {
    await seedProject(env.workspace, "web", { inherits: ["rules"] })
    const res = await createArtifact(
      jsonRequest("http://t/api/artifacts?scope=web", "POST", rule("shared", "- Project copy.\n"))
    )
    expect(res.status).toBe(201)
    expect(await exists(".black-agents/projects/web/artifacts/rules/shared.md")).toBe(true)
    expect(await exists(".cursor/rules/shared.mdc")).toBe(true)

    const scoped = await getArtifact(
      new Request("http://t/api/artifacts/rule/shared?scope=web"),
      artifactCtx("rule", "shared")
    )
    const scopedJson = await scoped.json()
    expect(scopedJson.data.scope).toEqual({ project: "web" })
    expect(scopedJson.data.body).toContain("Project copy")

    const workspace = await getArtifact(
      new Request("http://t/api/artifacts/rule/shared"),
      artifactCtx("rule", "shared")
    )
    expect((await workspace.json()).data.body).not.toContain("Project copy")
  })

  it("keeps inherited artifacts read-only from the project", async () => {
    await seedProject(env.workspace, "web", { inherits: ["rules"] })
    const put = await putArtifact(
      jsonRequest("http://t/api/artifacts/rule/workspace-only?scope=web", "PUT", rule("workspace-only", "- Changed.\n")),
      artifactCtx("rule", "workspace-only")
    )
    expect(put.status).toBe(403)
    const del = await deleteArtifact(
      new Request("http://t/api/artifacts/rule/workspace-only?scope=web", { method: "DELETE" }),
      artifactCtx("rule", "workspace-only")
    )
    expect(del.status).toBe(403)
    expect(await exists(".black-agents/artifacts/rules/workspace-only.md")).toBe(true)
  })

  it("rejects an unknown or invalid scope instead of falling back to the workspace", async () => {
    const ghost = await listArtifacts(new Request("http://t/api/artifacts?scope=ghost"))
    expect(ghost.status).toBe(404)
    const traversal = await createArtifact(
      jsonRequest("http://t/api/artifacts?scope=..%2F..", "POST", rule("escape"))
    )
    expect(traversal.status).toBe(400)
    expect(await exists(".black-agents/artifacts/rules/escape.md")).toBe(false)
  })
})
