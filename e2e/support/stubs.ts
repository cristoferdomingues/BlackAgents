import type { Page, Route } from "@playwright/test"

export const WORKSPACE = { path: "/tmp/black-agents-e2e", name: "black-agents-e2e" }

export interface StubArtifact {
  name: string
  type: "agent" | "skill" | "rule" | "command"
  description: string
  body?: string
}

export function artifact(a: StubArtifact) {
  const dir = a.type === "skill" ? `skills/${a.name}/SKILL.md` : `${a.type}s/${a.name}.${a.type === "rule" ? "mdc" : "md"}`
  return {
    name: a.name,
    type: a.type,
    platform: "cursor",
    description: a.description,
    frontmatter: { name: a.name, description: a.description },
    body: a.body ?? `Body of ${a.name}.`,
    relativePath: `.cursor/${dir}`,
  }
}

export async function stubWorkspace(page: Page, artifacts: StubArtifact[] = []): Promise<void> {
  await page.route("**/api/workspace", (route) =>
    route.fulfill({ json: { success: true, data: { active: WORKSPACE, workspaces: [WORKSPACE] } } })
  )
  await page.route("**/api/artifacts", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { success: true, data: artifacts.map(artifact) } })
    }
    return route.fallback()
  })
  await page.route("**/api/mcp", (route) =>
    route.fulfill({ json: { success: true, data: { servers: [], totalTools: 0 } } })
  )
}

export async function stubVerifiedProvider(page: Page): Promise<void> {
  await page.route("**/api/providers*", (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === "/api/providers/models") {
      return route.fulfill({ json: { success: true, data: { models: ["gpt-4o-mini"] } } })
    }
    return route.fulfill({
      json: {
        success: true,
        data: {
          providers: [{ id: "openai", label: "OpenAI", models: ["gpt-4o-mini"], requiresBaseUrl: false }],
          status: [
            {
              id: "openai",
              configured: true,
              verificationStatus: "valid",
              last4: "test",
              checkedAt: "2026-08-21T10:00:00.000Z",
            },
          ],
          defaults: { provider: "openai", model: "gpt-4o-mini" },
        },
      },
    })
  })
}

/** Encode events as one Server-Sent Events body. */
export function sse(events: Array<[string, unknown]>): string {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("")
}

export function fulfillSse(route: Route, events: Array<[string, unknown]>): Promise<void> {
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    body: sse(events),
  })
}
