import { describe, expect, it } from "vitest"

import { analyzeShellCommand, normalizeShellProgram } from "@/lib/runtime/tools/shell-risk"

function risk(command: string, args: string[] = []): string {
  return analyzeShellCommand(command, args).risk
}

describe("shell risk", () => {
  it("runs read-only commands directly", () => {
    for (const command of [
      "git status",
      "git diff --stat",
      "git log --oneline -5",
      "git branch",
      "git remote -v",
      "ls -la",
      "cat README.md",
      "head -n 5 package.json",
      "npm test",
      "npm run build",
      "pnpm test",
      "yarn test",
      "tsc --noEmit",
      "eslint src",
      "prettier --check .",
      "node -v",
      "python -m pytest",
      "go test ./...",
      "cargo test",
      "dotnet test",
      "make test",
      "rg TODO",
      "find . -name '*.ts'",
      "cd web && npm test",
    ]) {
      expect(risk(command), command).toBe("read")
    }
  })

  it("asks before writing", () => {
    for (const command of [
      "mkdir -p src/new",
      "cp a b",
      "copy a b",
      "mv a b",
      "touch out.txt",
      "git add .",
      "git commit -m 'x'",
      "git checkout -b feature",
      "eslint --fix .",
      "prettier --write .",
      "tsc",
      "make",
      "echo hi > out.txt",
    ]) {
      expect(risk(command), command).toBe("write")
    }
  })

  it("always asks before running a program", () => {
    for (const command of [
      "rm -rf build",
      "git push",
      "git reset --hard",
      "git clean -fd",
      "npm install",
      "npm run dev",
      "yarn",
      "curl https://example.com",
      "ssh host",
      "docker ps",
      "node script.js",
      "python script.py",
      "bash -c 'echo hi'",
      "find . -delete",
      "echo $(whoami)",
      "some-unknown-tool --flag",
    ]) {
      expect(risk(command), command).toBe("exec")
    }
  })

  it("uses the highest risk across a pipeline or sequence", () => {
    expect(risk("cat a | grep b")).toBe("read")
    expect(risk("npm test && npm run build")).toBe("read")
    expect(risk("npm test && git push")).toBe("exec")
    expect(risk("ls > files.txt")).toBe("write")
    expect(risk("ls && rm -rf x")).toBe("exec")
  })

  it("treats an empty or unparseable command as exec", () => {
    expect(risk("")).toBe("exec")
    expect(analyzeShellCommand(undefined, undefined).risk).toBe("exec")
    expect(analyzeShellCommand(42, ["x"]).risk).toBe("exec")
    expect(risk("&&")).toBe("exec")
  })

  it("reads a program with args passed separately", () => {
    expect(analyzeShellCommand("git", ["status"]).risk).toBe("read")
    expect(analyzeShellCommand("git", ["push"]).risk).toBe("exec")
    expect(analyzeShellCommand("npm", ["install"]).risk).toBe("exec")
    expect(analyzeShellCommand("npm", ["run", "build"]).risk).toBe("read")
    expect(analyzeShellCommand("mkdir", ["out"]).programs).toEqual(["mkdir"])
  })

  it("only trusts a plain sequence of write-risk programs", () => {
    expect(analyzeShellCommand("mkdir -p out", []).trustable).toBe(true)
    expect(analyzeShellCommand("mkdir out && cp a out/", []).trustable).toBe(true)
    expect(analyzeShellCommand("git commit -m x", []).trustable).toBe(true)

    expect(analyzeShellCommand("git push", []).trustable).toBe(false)
    expect(analyzeShellCommand("mkdir out > log", []).trustable).toBe(false)
    expect(analyzeShellCommand("cp $(ls) out", []).trustable).toBe(false)
    expect(analyzeShellCommand("npm test", []).trustable).toBe(false)
  })

  it("normalizes program names", () => {
    expect(normalizeShellProgram("C:\\Program Files\\nodejs\\node.exe")).toBe("node")
    expect(normalizeShellProgram("./node_modules/.bin/vitest")).toBe("vitest")
    expect(normalizeShellProgram("NPM.CMD")).toBe("npm")
    expect(normalizeShellProgram("bad name")).toBeNull()
    expect(normalizeShellProgram("")).toBeNull()
  })
})
