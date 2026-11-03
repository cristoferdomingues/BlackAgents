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
      "git branch --list 'feature/*'",
      "git tag -l 'v*'",
      "git remote -v",
      "git -C . status",
      "ls -la",
      "cat README.md",
      "head -n 5 package.json",
      "npm --version",
      "tsc --version",
      "eslint --version",
      "go env",
      "cargo metadata",
      "dotnet --info",
      "node -v",
      "rg TODO",
      "find . -name '*.ts'",
    ]) {
      expect(risk(command), command).toBe("read")
    }
  })

  it("asks before running project code, even in check-only mode", () => {
    for (const command of [
      "npm test",
      "npm run build",
      "pnpm test",
      "yarn test",
      "tsc --noEmit",
      "eslint src",
      "eslint --fix .",
      "prettier --check .",
      "prettier --write .",
      "node --test",
      "python -m pytest",
      "pytest",
      "mypy src",
      "ruff check .",
      "go test ./...",
      "cargo test",
      "dotnet test",
      "make test",
      "make",
      "gradle test",
      "vitest run",
      "git commit -m 'x'",
      "git merge feature",
      "cd web && npm test",
    ]) {
      const analysis = analyzeShellCommand(command, [])
      expect(analysis.risk, command).toBe("write")
      expect(analysis.projectCode, command).toBe(true)
    }
    // Plain index/ref changes do not run repository hooks.
    expect(analyzeShellCommand("git add .", []).projectCode).toBe(false)
    expect(analyzeShellCommand("git branch feature", []).projectCode).toBe(false)
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
      "git branch feature",
      "git branch -f main HEAD",
      "git branch --set-upstream-to=origin/main",
      "git tag v1.0",
      "find . -fprint out.txt",
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
      "find . -exec rm {} ;",
      "find . -okdir rm {} ;",
      "date -s '2020-01-01'",
      "tar --to-command='sh -c id' -xf a.tar",
      "tar --checkpoint-action=exec=sh -xf a.tar",
      "tar -I zstd -cf a.tar dir",
      "echo $(whoami)",
      "some-unknown-tool --flag",
    ]) {
      expect(risk(command), command).toBe("exec")
    }
  })

  it("escalates reads that point outside the workspace", () => {
    for (const command of [
      "cat /etc/passwd",
      "cat ~/.ssh/id_rsa",
      "cat ../secret.txt",
      "cd /tmp",
      "cat C:\\Windows\\win.ini",
      "cat $HOME/.env",
      "cat %USERPROFILE%\\.env",
      "git -C /tmp status",
      "cp a /tmp/b",
    ]) {
      const analysis = analyzeShellCommand(command, [])
      expect(analysis.escapesWorkspace, command).toBe(true)
      expect(analysis.trustable, command).toBe(false)
      expect(analysis.risk, command).toBe("write")
    }
    expect(analyzeShellCommand("cat README.md", []).escapesWorkspace).toBe(false)
    expect(analyzeShellCommand("cp a b", []).escapesWorkspace).toBe(false)
  })

  it("uses the highest risk across a pipeline or sequence", () => {
    expect(risk("cat a | grep b")).toBe("read")
    expect(risk("npm test && npm run build")).toBe("write")
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
    expect(analyzeShellCommand("npm", ["run", "build"]).risk).toBe("write")
    expect(analyzeShellCommand("npm", ["run", "build"]).projectCode).toBe(true)
    expect(analyzeShellCommand("mkdir", ["out"]).programs).toEqual(["mkdir"])
  })

  it("only trusts a plain sequence of write-risk programs", () => {
    expect(analyzeShellCommand("mkdir -p out", []).trustable).toBe(true)
    expect(analyzeShellCommand("mkdir out && cp a out/", []).trustable).toBe(true)
    expect(analyzeShellCommand("git commit -m x", []).trustable).toBe(true)
    // Project code is write risk, so an explicit program grant can remember it.
    expect(analyzeShellCommand("npm test", []).trustable).toBe(true)

    expect(analyzeShellCommand("git push", []).trustable).toBe(false)
    expect(analyzeShellCommand("mkdir out > log", []).trustable).toBe(false)
    expect(analyzeShellCommand("cp $(ls) out", []).trustable).toBe(false)
    expect(analyzeShellCommand("cat /etc/passwd", []).trustable).toBe(false)
  })

  it("normalizes program names", () => {
    expect(normalizeShellProgram("C:\\Program Files\\nodejs\\node.exe")).toBe("node")
    expect(normalizeShellProgram("./node_modules/.bin/vitest")).toBe("vitest")
    expect(normalizeShellProgram("NPM.CMD")).toBe("npm")
    expect(normalizeShellProgram("bad name")).toBeNull()
    expect(normalizeShellProgram("")).toBeNull()
  })
})
