import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export interface TempEnv {
  /** Isolated ~/.black-agents replacement. */
  configDir: string
  /** The active workspace root. */
  workspace: string
  cleanup: () => Promise<void>
}

/**
 * Create an isolated config dir + workspace and point the app's config at it via
 * BLACK_AGENTS_CONFIG_DIR, so tests never touch the developer's real
 * ~/.black-agents or their saved workspaces.
 */
export async function makeTempEnv(): Promise<TempEnv> {
  const base = await mkdtemp(path.join(tmpdir(), "ba-test-"))
  const configDir = path.join(base, "config")
  const workspace = path.join(base, "workspace")
  await mkdir(configDir, { recursive: true })
  await mkdir(workspace, { recursive: true })

  process.env.BLACK_AGENTS_CONFIG_DIR = configDir
  await writeFile(
    path.join(configDir, "config.json"),
    JSON.stringify({ currentPath: workspace, workspaces: [workspace] }, null, 2),
    "utf8"
  )

  return {
    configDir,
    workspace,
    async cleanup() {
      delete process.env.BLACK_AGENTS_CONFIG_DIR
      await rm(base, { recursive: true, force: true })
    },
  }
}

/** Write an artifact file into the workspace under the Cursor layout. */
export async function seedArtifact(
  workspace: string,
  relPath: string,
  content: string
): Promise<void> {
  const abs = path.join(workspace, relPath)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content, "utf8")
}

/** Build a Request suitable for calling a route handler directly. */
export function jsonRequest(
  url: string,
  method: string,
  body?: unknown
): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
