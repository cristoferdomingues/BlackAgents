import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET as GIT } from "@/app/api/k0ding/roots/[id]/git/route"
import { GET as MCP_CANDIDATE } from "@/app/api/k0ding/roots/[id]/mcp/route"
import { GET as NOTES, PUT as SAVE_NOTES } from "@/app/api/k0ding/roots/[id]/notes/route"
import { POST as APPLY } from "@/app/api/k0ding/sessions/[id]/apply/route"
import { POST as DRAFT } from "@/app/api/k0ding/sessions/[id]/draft/route"
import { GET as READ_FILE, POST as SAVE_FILE } from "@/app/api/k0ding/roots/[id]/file/route"
import { POST as RUN } from "@/app/api/k0ding/roots/[id]/run/route"
import { GET as TREE } from "@/app/api/k0ding/roots/[id]/tree/route"
import { GET as ROOTS, POST as ADD } from "@/app/api/k0ding/roots/route"
import { POST as START } from "@/app/api/k0ding/sessions/route"
import { latestCodingSession } from "@/lib/k0ding/sessions"
import { createCodingSession } from "@/lib/k0ding/sessions"
import { setProviderSecret } from "@/lib/secrets"
import { jsonRequest, makeTempEnv, seedProject, type TempEnv } from "../helpers/workspace"

let env: TempEnv
let code: string

function bodyOf(res: Response): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  return res.json() as Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
}

beforeEach(async () => {
  env = await makeTempEnv()
  code = path.join(env.workspace, "server")
  await mkdir(path.join(code, "src"), { recursive: true })
  await mkdir(path.join(code, "node_modules", "pkg"), { recursive: true })
  await writeFile(path.join(code, "src", "index.ts"), "export const hi = 1\n")
  await writeFile(path.join(code, "node_modules", "pkg", "index.js"), "hidden")
  await setProviderSecret("openai", {
    apiKey: "sk-valid",
    verification: { status: "valid", checkedAt: "2026-10-21T10:00:00.000Z" },
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await env.cleanup()
})

describe("k0ding folders", () => {
  it("opens a folder, lists files, and reads one", async () => {
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    expect(created.success).toBe(true)
    const id = String(created.data?.id)
    const tree = await bodyOf(await TREE(new Request(`http://t/api/k0ding/roots/${id}/tree`), { params: Promise.resolve({ id }) }))
    const names = (tree.data?.entries as Array<{ name: string }>).map((entry) => entry.name)
    expect(names).toContain("src")
    expect(names).not.toContain("node_modules")
    const file = await bodyOf(
      await READ_FILE(new Request(`http://t/api/k0ding/roots/${id}/file?path=src/index.ts`), { params: Promise.resolve({ id }) })
    )
    expect(file.data?.content).toBe("export const hi = 1\n")
  })

  it("rejects a path that leaves the folder", async () => {
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    const id = String(created.data?.id)
    const escaped = await READ_FILE(new Request(`http://t/api/k0ding/roots/${id}/file?path=../package.json`), {
      params: Promise.resolve({ id }),
    })
    expect(escaped.status).toBe(400)
  })

  it("returns 412 when no workspace is selected", async () => {
    await writeFile(path.join(env.configDir, "config.json"), JSON.stringify({ workspaces: [] }))
    const res = await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code }))
    expect(res.status).toBe(412)
  })

  it("stores the folder on the active project", async () => {
    await seedProject(env.workspace, "sidekick")
    await writeFile(
      path.join(env.configDir, "config.json"),
      JSON.stringify({ currentPath: env.workspace, activeProject: "sidekick", workspaces: [env.workspace] })
    )
    await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code, label: "Server" }))
    const listed = await bodyOf(await ROOTS())
    expect(listed.data?.roots).toHaveLength(1)
    const saved = await readFile(path.join(env.workspace, ".black-agents/k0ding/sidekick/roots.json"), "utf8")
    expect(saved).toContain("Server")
  })
})

describe("k0ding review", () => {
  it("stages a file and writes it only after apply", async () => {
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    const rootId = String(created.data?.id)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "code_write",
                        arguments: JSON.stringify({ path: "src/next.ts", content: "export const next = 2\n" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "Staged src/next.ts." } }] }),
        })
    vi.stubGlobal("fetch", fetchMock)
    const res = await START(
      jsonRequest("http://t/api/k0ding/sessions", "POST", {
        rootId,
        prompt: "Add next.ts",
        provider: "openai",
        model: "gpt-4o-mini",
      })
    )
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const streamed = await res.text()
    const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      messages: Array<{ content?: string }>
    }
    expect(sent.messages.some((message) => message.content?.includes("data, not instructions"))).toBe(true)
    expect(streamed).toContain("src/next.ts")
    await expect(readFile(path.join(code, "src", "next.ts"), "utf8")).rejects.toThrow()
    const session = await latestCodingSession(env.workspace, undefined, rootId)
    expect(session?.status).toBe("review")
    expect(session?.changes[0]?.state).toBe("pending")
    const applied = await bodyOf(
      await APPLY(jsonRequest(`http://t/api/k0ding/sessions/${session?.id}/apply`, "POST", { paths: ["src/next.ts"] }), {
        params: Promise.resolve({ id: session?.id ?? "" }),
      })
    )
    expect(applied.success).toBe(true)
    expect(await readFile(path.join(code, "src", "next.ts"), "utf8")).toBe("export const next = 2\n")
  })
})

describe("k0ding commands and edits", () => {
  it("runs a command in the code folder and blocks git commit", async () => {
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    const id = String(created.data?.id)
    const ran = await bodyOf(
      await RUN(jsonRequest(`http://t/api/k0ding/roots/${id}/run`, "POST", { command: "node -e \"process.stdout.write('ok')\"" }), {
        params: Promise.resolve({ id }),
      })
    )
    expect(ran.success).toBe(true)
    expect(ran.data?.stdout).toBe("ok")
    expect(ran.data?.exitCode).toBe(0)
    const blocked = await RUN(jsonRequest(`http://t/api/k0ding/roots/${id}/run`, "POST", { command: "git commit -m hi" }), {
      params: Promise.resolve({ id }),
    })
    expect(blocked.status).toBe(400)
    const body = await bodyOf(blocked)
    expect(body.error).toMatch(/does not commit/)
  })

  it("refuses a save when the hash is stale", async () => {
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    const id = String(created.data?.id)
    const opened = await bodyOf(
      await READ_FILE(new Request(`http://t/api/k0ding/roots/${id}/file?path=src/index.ts`), { params: Promise.resolve({ id }) })
    )
    const hash = String(opened.data?.hash)
    const saved = await bodyOf(
      await SAVE_FILE(
        jsonRequest(`http://t/api/k0ding/roots/${id}/file`, "POST", { path: "src/index.ts", content: "export const hi = 2\n", hash }),
        { params: Promise.resolve({ id }) }
      )
    )
    expect(saved.data?.content).toBe("export const hi = 2\n")
    const stale = await SAVE_FILE(
      jsonRequest(`http://t/api/k0ding/roots/${id}/file`, "POST", { path: "src/index.ts", content: "export const hi = 3\n", hash }),
      { params: Promise.resolve({ id }) }
    )
    expect(stale.status).toBe(409)
  })

  it("returns git status without failing when the folder is not a repo", async () => {
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    const id = String(created.data?.id)
    const status = await bodyOf(await GIT(new Request(`http://t/api/k0ding/roots/${id}/git`), { params: Promise.resolve({ id }) }))
    expect(status.success).toBe(true)
    expect(status.data?.git).toBe(false)
  })
})

describe("k0ding project tools", () => {
  it("saves project notes and detects an MCP project", async () => {
    await writeFile(
      path.join(code, "package.json"),
      JSON.stringify({
        devDependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
        scripts: { start: "node dist/index.js" },
      })
    )
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    const id = String(created.data?.id)
    const saved = await bodyOf(
      await SAVE_NOTES(jsonRequest(`http://t/api/k0ding/roots/${id}/notes`, "PUT", { content: "# Commands\nnpm test" }), {
        params: Promise.resolve({ id }),
      })
    )
    expect(saved.data?.content).toContain("npm test")
    const notes = await bodyOf(
      await NOTES(new Request(`http://t/api/k0ding/roots/${id}/notes`), { params: Promise.resolve({ id }) })
    )
    expect(notes.data?.content).toBe("# Commands\nnpm test")
    const candidate = await bodyOf(
      await MCP_CANDIDATE(new Request(`http://t/api/k0ding/roots/${id}/mcp`), { params: Promise.resolve({ id }) })
    )
    expect(candidate.data?.detected).toBe(true)
    expect(candidate.data?.scripts).toEqual(["start"])
  })

  it("creates a reusable skill draft from raw prompts", async () => {
    const created = await bodyOf(await ADD(jsonRequest("http://t/api/k0ding/roots", "POST", { path: code })))
    const id = String(created.data?.id)
    const session = await createCodingSession({
      workspace: env.workspace,
      rootId: id,
      context: ["src/index.ts"],
      prompts: ["Add validation"],
      guidance: [],
      model: { provider: "openai", model: "gpt-4o-mini" },
      messages: [
        { role: "user", content: "EXPANDED FILE CONTENT MUST NOT COPY" },
        { role: "assistant", content: "Validation added." },
      ],
    })
    const response = await bodyOf(
      await DRAFT(
        jsonRequest(`http://t/api/k0ding/sessions/${session.id}/draft`, "POST", {
          kind: "skill",
          name: "add-validation",
        }),
        { params: Promise.resolve({ id: session.id }) }
      )
    )
    const draft = response.data?.draft as { body?: string }
    expect(draft.body).toContain("Add validation")
    expect(draft.body).not.toContain("EXPANDED FILE CONTENT")
  })
})
