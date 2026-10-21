import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { applyChanges, replaceOnce } from "@/lib/k0ding/changes"
import { compileGitignore, isIgnored } from "@/lib/k0ding/ignore"
import { listCodeTree, searchCode } from "@/lib/k0ding/listing"
import { blockedRootReason, resolveInRoot } from "@/lib/k0ding/paths"
import { readCodeFile } from "@/lib/k0ding/read-file"
import { sha256 } from "@/lib/k0ding/paths"
import { isSecretPath } from "@/lib/k0ding/secrets"
import { K0dingError } from "@/lib/k0ding/errors"
import type { CodeRoot } from "@/lib/k0ding/schema"

let root: string

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

function codeRoot(abs: string): CodeRoot {
  return { id: "demo", path: abs, label: "demo", hidden: [] }
}

describe("path guard", () => {
  it("rejects a path that leaves the folder", () => {
    expect(() => resolveInRoot("/work/app", "../secret")).toThrow(K0dingError)
    expect(() => resolveInRoot("/work/app", "/etc/passwd")).toThrow(K0dingError)
  })

  it("rejects the home folder and the disk root", () => {
    expect(blockedRootReason("/")).toBeTruthy()
  })

  it("does not follow a symlink out of the folder", async () => {
    root = await mkdtemp(path.join(tmpdir(), "k0-"))
    const inside = path.join(root, "inside")
    const outside = path.join(root, "outside")
    await mkdir(inside)
    await mkdir(outside)
    await writeFile(path.join(outside, "secret.txt"), "nope")
    await symlink(outside, path.join(inside, "link"))
    await expect(readCodeFile(inside, "link/secret.txt")).rejects.toThrow(/leaves the code folder/)
    const entries = await listCodeTree(codeRoot(inside), "", false)
    expect(entries.map((entry) => entry.name)).not.toContain("link")
  })
})

describe("ignore and secrets", () => {
  it("hides gitignore matches and can un-ignore a file", () => {
    const rules = compileGitignore("*.log\n!keep.log\nnode_modules/\n/dist\n")
    expect(isIgnored("debug.log", false, rules)).toBe(true)
    expect(isIgnored("src/debug.log", false, rules)).toBe(true)
    expect(isIgnored("keep.log", false, rules)).toBe(false)
    expect(isIgnored("node_modules", true, rules)).toBe(true)
    expect(isIgnored("dist", true, rules)).toBe(true)
    expect(isIgnored("src/dist", true, rules)).toBe(false)
  })

  it("treats env files and keys as secret", () => {
    expect(isSecretPath(".env")).toBe(true)
    expect(isSecretPath("config/.env.local")).toBe(true)
    expect(isSecretPath("keys/id_rsa")).toBe(true)
    expect(isSecretPath(".git/config")).toBe(true)
    expect(isSecretPath("src/index.ts")).toBe(false)
  })

  it("skips node_modules and secret files when searching", async () => {
    root = await mkdtemp(path.join(tmpdir(), "k0-"))
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "needle")
    await writeFile(path.join(root, ".env"), "needle")
    await writeFile(path.join(root, "src", "app.ts"), "const needle = 1\n")
    const found = await searchCode(codeRoot(root), "needle")
    expect(found.matches.map((match) => match.path)).toEqual(["src/app.ts"])
  })
})

describe("staged edits", () => {
  it("replaces one exact block and refuses two matches", () => {
    const once = replaceOnce("alpha beta alpha", "beta", "gamma")
    expect(once.ok && once.content).toBe("alpha gamma alpha")
    const twice = replaceOnce("beta beta", "beta", "gamma")
    expect(twice.ok).toBe(false)
  })

  it("does not write a file that changed after it was read", async () => {
    root = await mkdtemp(path.join(tmpdir(), "k0-"))
    const file = path.join(root, "app.ts")
    await writeFile(file, "one\n")
    const changes = await applyChanges(root, [
      { path: "app.ts", kind: "update", baseHash: sha256("other\n"), content: "two\n", state: "pending" },
    ], ["app.ts"])
    expect(changes[0]?.state).toBe("conflict")
    expect(await readCodeFile(root, "app.ts")).toMatchObject({ content: "one\n" })
  })

  it("writes a staged file when the hash still matches", async () => {
    root = await mkdtemp(path.join(tmpdir(), "k0-"))
    await writeFile(path.join(root, "app.ts"), "one\n")
    const changes = await applyChanges(root, [
      { path: "app.ts", kind: "update", baseHash: sha256("one\n"), content: "two\n", state: "pending" },
    ], ["app.ts"])
    expect(changes[0]?.state).toBe("applied")
    expect(await readCodeFile(root, "app.ts")).toMatchObject({ content: "two\n" })
  })
})
