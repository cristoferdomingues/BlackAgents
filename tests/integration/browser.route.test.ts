import { afterEach, beforeEach, describe, expect, it } from "vitest"
import path from "node:path"
import { readFile } from "node:fs/promises"

import { GET as getBrowser, POST as postBrowser } from "@/app/api/browser/route"
import { POST as postRecord } from "@/app/api/browser/record/route"
import { POST as postFromTraces } from "@/app/api/browser/flows/from-traces/route"
import { DESKTOP_ENV_FLAG } from "@/lib/browser/constants"
import { makeTempEnv, jsonRequest, type TempEnv } from "../helpers/workspace"

let env: TempEnv

beforeEach(async () => {
  env = await makeTempEnv()
  process.env[DESKTOP_ENV_FLAG] = "1"
})

afterEach(async () => {
  delete process.env[DESKTOP_ENV_FLAG]
  await env.cleanup()
})

describe("GET /api/browser", () => {
  it("reports desktop status and empty flows", async () => {
    const res = await getBrowser()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.desktop).toBe(true)
    expect(json.data.flows).toEqual([])
    expect(json.data.reason).toBeNull()
  })
})

describe("POST /api/browser setup", () => {
  it("registers the browser MCP server as risky", async () => {
    const res = await postBrowser(
      jsonRequest("http://t/api/browser", "POST", { action: "setup" })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.configured).toBe(true)
    expect(json.data.trust).toBe("risky")

    const mcpRaw = await readFile(
      path.join(env.workspace, ".black-agents", "mcp.json"),
      "utf8"
    )
    const mcp = JSON.parse(mcpRaw) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>
    }
    expect(mcp.mcpServers.browser.command).toBe("npx")
    expect(mcp.mcpServers.browser.args).toContain("@playwright/mcp@latest")

    const policyRaw = await readFile(
      path.join(env.workspace, ".black-agents", "mcp-policy.json"),
      "utf8"
    )
    const policy = JSON.parse(policyRaw) as { servers: Record<string, string> }
    expect(policy.servers.browser).toBe("risky")
  })

  it("rejects setup when not on desktop", async () => {
    delete process.env[DESKTOP_ENV_FLAG]
    const res = await postBrowser(
      jsonRequest("http://t/api/browser", "POST", { action: "setup" })
    )
    expect(res.status).toBe(412)
  })
})

describe("browser coach save + record", () => {
  it("saves a flow from traces", async () => {
    const res = await postFromTraces(
      jsonRequest("http://t/api/browser/flows/from-traces", "POST", {
        name: "time-registration",
        description: "coached",
        traces: [
          {
            id: "a",
            server: "browser",
            tool: "browser_navigate",
            args: { url: "https://hr.example/time" },
          },
          {
            id: "b",
            server: "browser",
            tool: "browser_click",
            args: { element: "Submit" },
          },
        ],
        bind: true,
      })
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.flow.steps).toHaveLength(2)
    expect(json.data.binding.created.length).toBeGreaterThan(0)

    const skill = await readFile(
      path.join(env.workspace, ".cursor", "skills", "time-registration", "SKILL.md"),
      "utf8"
    )
    expect(skill).toContain("time-registration")
  })

  it("records and saves a flow", async () => {
    const { appendRecordingSteps } = await import("@/lib/browser/recording")

    await postBrowser(
      jsonRequest("http://t/api/browser", "POST", { action: "setup" })
    )
    await postRecord(
      jsonRequest("http://t/api/browser/record", "POST", { action: "start" })
    )

    appendRecordingSteps(env.workspace, [
      {
        id: "step_1",
        tool: "browser_navigate",
        args: { url: "https://hr.example/time" },
      },
    ])

    const stop = await postRecord(
      jsonRequest("http://t/api/browser/record", "POST", {
        action: "stop",
        saveAs: "recorded-flow",
        bind: true,
      })
    )
    expect(stop.status).toBe(200)
    const json = await stop.json()
    expect(json.data.flow.name).toBe("recorded-flow")
    expect(json.data.flow.steps).toHaveLength(1)
  })
})
