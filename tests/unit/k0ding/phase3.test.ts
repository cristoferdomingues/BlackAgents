import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { K0dingError } from "@/lib/k0ding/errors"
import { parsePorcelain } from "@/lib/k0ding/git"
import { sha256 } from "@/lib/k0ding/paths"
import { readCodeFile } from "@/lib/k0ding/read-file"
import { saveCodeFile } from "@/lib/k0ding/save-file"
import { blockedCommandReason } from "@/lib/k0ding/shell"

let root: string

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe("shell guard", () => {
  it("blocks git writes and allows git status", () => {
    expect(blockedCommandReason("git commit -m hi")).toMatch(/does not commit/)
    expect(blockedCommandReason("git push origin main")).toMatch(/does not commit/)
    expect(blockedCommandReason("git status")).toBeNull()
    expect(blockedCommandReason("npm test")).toBeNull()
  })
})

describe("git porcelain", () => {
  it("reads changed paths and a rename", () => {
    const text = " M src/index.ts\0R  old.ts\0src/new.ts\0"
    expect(parsePorcelain(text)).toEqual(["src/index.ts", "old.ts", "src/new.ts"])
  })
})

describe("hand edit", () => {
  it("saves when the hash matches and refuses a stale hash", async () => {
    root = await mkdtemp(path.join(tmpdir(), "k0-"))
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "index.ts"), "export const hi = 1\n")
    const opened = await readCodeFile(root, "src/index.ts")
    const saved = await saveCodeFile(root, "src/index.ts", "export const hi = 2\n", opened.hash ?? "")
    expect(saved.content).toBe("export const hi = 2\n")
    expect(saved.hash).toBe(sha256("export const hi = 2\n"))
    await expect(saveCodeFile(root, "src/index.ts", "export const hi = 3\n", opened.hash ?? "")).rejects.toBeInstanceOf(
      K0dingError
    )
  })
})
