import type { ToolRisk } from "../types"

/**
 * Classify a `shell_run` command by what it actually does.
 *
 * The goal is to stop asking for read-only commands (`git status`, `ls`,
 * `npm test`) while keeping the approval card for anything that writes,
 * installs, reaches the network, or can run arbitrary code. Unknown commands
 * are `exec`, so a new tool never becomes silently trusted.
 *
 * `trustable` is true only for a plain sequence of write-risk programs with no
 * redirects or substitutions. That is the narrow case a workspace can remember
 * ("always allow `mkdir`"), and it never covers an `exec` command.
 */

export interface ShellAnalysis {
  risk: ToolRisk
  /** Every program a segment would run, normalized (lowercase, no path/ext). */
  programs: string[]
  /** True when the whole line is a plain sequence of write-risk programs. */
  trustable: boolean
}

/** Programs that only read. */
const READ_PROGRAMS = new Set([
  "ls",
  "dir",
  "cat",
  "type",
  "pwd",
  "cd",
  "pushd",
  "popd",
  "echo",
  "where",
  "which",
  "whoami",
  "hostname",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "findstr",
  "find",
  "sort",
  "uniq",
  "tree",
  "du",
  "df",
  "stat",
  "file",
  "diff",
  "cmp",
  "date",
  "ver",
  "uname",
  "printenv",
  "basename",
  "dirname",
  "realpath",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "jq",
  "cut",
  "tr",
  "nl",
  "less",
  "more",
])

/** Programs that create or change files. */
const WRITE_PROGRAMS = new Set([
  "cp",
  "copy",
  "mv",
  "move",
  "ren",
  "rename",
  "mkdir",
  "md",
  "touch",
  "ln",
  "mklink",
  "xcopy",
  "robocopy",
  "tar",
  "unzip",
  "zip",
  "7z",
  "tee",
])

/** Programs that run arbitrary code, reach the network, or destroy data. */
const EXEC_PROGRAMS = new Set([
  "rm",
  "del",
  "erase",
  "rd",
  "rmdir",
  "chmod",
  "chown",
  "sudo",
  "mkfs",
  "dd",
  "shutdown",
  "reboot",
  "format",
  "diskpart",
  "reg",
  "regedit",
  "sc",
  "net",
  "taskkill",
  "kill",
  "pkill",
  "killall",
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "ftp",
  "sftp",
  "nc",
  "ncat",
  "telnet",
  "docker",
  "podman",
  "kubectl",
  "helm",
  "terraform",
  "aws",
  "gcloud",
  "az",
  "ansible",
  "ansible-playbook",
  "ruby",
  "php",
  "perl",
  "java",
  "deno",
  "cmd",
  "sh",
  "bash",
  "zsh",
  "fish",
  "powershell",
  "pwsh",
  "npx",
  "xargs",
  "gh",
  "code",
  "cursor",
])

/** Script names that are safe to run without asking. */
const SAFE_SCRIPTS = new Set([
  "test",
  "tests",
  "lint",
  "typecheck",
  "type-check",
  "build",
  "check",
  "format:check",
  "test:unit",
  "test:e2e",
  "verify",
])

const GIT_READ = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "describe",
  "blame",
  "shortlog",
  "grep",
  "whatchanged",
  "fsck",
  "count-objects",
])

const GIT_WRITE = new Set([
  "add",
  "commit",
  "checkout",
  "switch",
  "merge",
  "cherry-pick",
  "revert",
  "stash",
  "mv",
  "apply",
  "am",
  "fetch",
  "pull",
  "clone",
  "init",
  "tag",
  "branch",
  "remote",
  "config",
])

const GIT_EXEC = new Set([
  "push",
  "reset",
  "clean",
  "rebase",
  "restore",
  "rm",
  "filter-branch",
  "gc",
  "prune",
  "update-ref",
  "symbolic-ref",
])

const RISK_ORDER: Record<ToolRisk, number> = { read: 0, write: 1, exec: 2 }

function maxRisk(a: ToolRisk, b: ToolRisk): ToolRisk {
  return RISK_ORDER[b] > RISK_ORDER[a] ? b : a
}

export function normalizeShellProgram(value: string): string | null {
  const base = value.trim().split(/[\\/]/).pop() ?? ""
  const name = base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase()
  return /^[a-z0-9._+-]+$/.test(name) ? name : null
}

interface Segment {
  risk: ToolRisk
  program: string | null
}

function words(segment: string): string[] {
  const out: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current)
        current = ""
      }
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

/** Split a command line on shell operators, tracking quotes and redirections. */
function splitSegments(line: string): { segments: string[]; hasRedirect: boolean } {
  const segments: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let hasRedirect = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === "\\") {
      current += ch
      if (i + 1 < line.length) current += line[++i]
      continue
    }
    if (ch === ">") {
      // `2>&1` is a file-descriptor copy, not a file write.
      if (line[i + 1] === "&") {
        current += ">&"
        i++
        while (/\d/.test(line[i + 1] ?? "")) current += line[++i]
        continue
      }
      hasRedirect = true
      current += ch
      if (line[i + 1] === ">") current += line[++i]
      continue
    }
    const two = line.slice(i, i + 2)
    if (two === "&&" || two === "||") {
      segments.push(current)
      current = ""
      i++
      continue
    }
    if (ch === "|" || ch === ";" || ch === "&" || ch === "\n") {
      segments.push(current)
      current = ""
      continue
    }
    current += ch
  }
  segments.push(current)
  return { segments: segments.map((s) => s.trim()).filter(Boolean), hasRedirect }
}

function gitRisk(args: string[]): ToolRisk {
  const sub = args[0]
  if (!sub || sub === "--version" || sub === "-v") return "read"
  if (GIT_READ.has(sub)) return "read"
  if (GIT_EXEC.has(sub)) return "exec"
  if (sub === "reflog") {
    return args[1] === "expire" || args[1] === "delete" ? "exec" : "read"
  }
  if (sub === "branch") {
    return args.some((a) => /^-[dDmM]$|^--delete$|^--move$/.test(a)) ? "write" : "read"
  }
  if (sub === "remote") {
    return args.some((a) => ["add", "remove", "rm", "set-url", "rename"].includes(a))
      ? "write"
      : "read"
  }
  if (sub === "tag") {
    return args.some((a) => /^-[adsm]$|^--delete$|^--annotate$/.test(a)) ? "write" : "read"
  }
  if (sub === "config") {
    return args.some((a) => ["--get", "--get-all", "--list", "-l"].includes(a)) ? "read" : "write"
  }
  if (sub === "stash") {
    return args[1] === "list" || args[1] === "show" ? "read" : "write"
  }
  if (GIT_WRITE.has(sub)) return "write"
  return "exec"
}

function packageManagerRisk(program: string, args: string[]): ToolRisk {
  const first = args[0]
  // Bare `yarn` is `yarn install`; the others just print help.
  if (!first) return program === "yarn" ? "exec" : "read"
  if (first === "--version" || first === "-v") return "read"
  if (first === "run" || first === "run-script") {
    const script = args[1]
    return script && SAFE_SCRIPTS.has(script) ? "read" : "exec"
  }
  if (first === "test" || first === "t") return "read"
  if (first === "exec" || first === "dlx" || first === "x") return "exec"
  if (
    [
      "install",
      "i",
      "ci",
      "add",
      "remove",
      "rm",
      "uninstall",
      "update",
      "up",
      "publish",
      "link",
      "patch",
      "dedupe",
      "prune",
      "start",
      "dev",
    ].includes(first)
  ) {
    return "exec"
  }
  // pnpm/yarn/bun accept a script name without `run`.
  if (program !== "npm" && SAFE_SCRIPTS.has(first)) return "read"
  return "exec"
}

function runnerRisk(program: string, args: string[]): ToolRisk {
  const first = args[0]
  if (program === "tsc") {
    if (first === "--version" || first === "-v") return "read"
    return args.some((a) => a === "--noEmit" || a === "-noEmit") ? "read" : "write"
  }
  if (program === "eslint") {
    return args.some((a) => a === "--fix") ? "write" : "read"
  }
  if (program === "prettier") {
    return args.some((a) => a === "--write" || a === "-w") ? "write" : "read"
  }
  if (program === "playwright" || program === "cypress") {
    return first === "install" ? "exec" : "read"
  }
  if (program === "node") {
    if (first === "-v" || first === "--version") return "read"
    return first === "--test" ? "read" : "exec"
  }
  if (program === "python" || program === "python3") {
    if (first === "-V" || first === "--version") return "read"
    if (first === "-m" && (args[1] === "pytest" || args[1] === "unittest")) return "read"
    return "exec"
  }
  if (program === "go") {
    if (first === "test" || first === "vet") return "read"
    if (first === "fmt" || first === "build") return "write"
    return first ? "exec" : "read"
  }
  if (program === "cargo") {
    if (["test", "check", "clippy"].includes(first ?? "")) return "read"
    if (first === "fmt") return args.includes("--check") ? "read" : "write"
    if (first === "build") return "write"
    return first ? "exec" : "read"
  }
  if (program === "dotnet") {
    if (first === "test") return "read"
    if (first === "build" || first === "restore") return "write"
    return first ? "exec" : "read"
  }
  if (program === "make" || program === "just") {
    // No target runs the default target, which usually builds.
    if (!first) return "write"
    return ["test", "check", "lint"].includes(first) ? "read" : "exec"
  }
  if (program === "gradle" || program === "gradlew" || program === "mvn") {
    if (["test", "check"].includes(first ?? "")) return "read"
    if (["build", "package", "install"].includes(first ?? "")) return "write"
    return first ? "exec" : "write"
  }
  // Jest, vitest, mocha, ava, tap and similar test runners only read.
  return "read"
}

function segmentRisk(segment: string): Segment {
  const parts = words(segment)
  const raw = parts[0]
  if (!raw) return { risk: "read", program: null }
  const program = normalizeShellProgram(raw)
  if (!program) return { risk: "exec", program: null }
  const args = parts.slice(1)
  if (READ_PROGRAMS.has(program)) {
    if (program === "find" && args.some((a) => /^-(exec|execdir|ok|delete)$/.test(a))) {
      return { risk: "exec", program }
    }
    if (program === "sort" && args.some((a) => a === "-o" || /^-o./.test(a) || a.startsWith("--output"))) {
      return { risk: "write", program }
    }
    // `uniq INPUT OUTPUT` writes the second path.
    if (program === "uniq" && args.filter((a) => !a.startsWith("-")).length > 1) {
      return { risk: "write", program }
    }
    return { risk: "read", program }
  }
  if (WRITE_PROGRAMS.has(program)) return { risk: "write", program }
  if (EXEC_PROGRAMS.has(program)) return { risk: "exec", program }
  if (program === "sed") {
    return {
      risk: args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === "--in-place" || a.startsWith("--in-place="))
        ? "write"
        : "read",
      program,
    }
  }
  if (program === "git") return { risk: gitRisk(args), program }
  if (["npm", "pnpm", "yarn", "bun"].includes(program)) {
    return { risk: packageManagerRisk(program, args), program }
  }
  if (
    ["tsc", "eslint", "prettier", "jest", "vitest", "mocha", "ava", "tap", "playwright", "cypress"].includes(
      program
    )
  ) {
    return { risk: runnerRisk(program, args), program }
  }
  if (["node", "python", "python3", "go", "cargo", "dotnet", "make", "just", "gradle", "gradlew", "mvn"].includes(program)) {
    return { risk: runnerRisk(program, args), program }
  }
  return { risk: "exec", program }
}

function analyzeLine(line: string): ShellAnalysis {
  const trimmed = line.trim()
  if (!trimmed) return { risk: "exec", programs: [], trustable: false }
  const { segments, hasRedirect } = splitSegments(trimmed)
  const hasSubstitution = /`|\$\(/.test(trimmed)
  if (segments.length === 0) return { risk: "exec", programs: [], trustable: false }

  const parsed = segments.map(segmentRisk)
  let risk = hasRedirect ? ("write" as ToolRisk) : ("read" as ToolRisk)
  for (const segment of parsed) risk = maxRisk(risk, segment.risk)
  if (hasSubstitution) risk = "exec"

  const programs = parsed
    .map((segment) => segment.program)
    .filter((program): program is string => Boolean(program))
  const trustable =
    !hasRedirect &&
    !hasSubstitution &&
    programs.length === parsed.length &&
    parsed.every((segment) => segment.risk === "write")

  return { risk, programs, trustable }
}

/** Classify a `shell_run` call. Anything unparseable is `exec`. */
export function analyzeShellCommand(command: unknown, args: unknown): ShellAnalysis {
  if (typeof command !== "string" || !command.trim()) {
    return { risk: "exec", programs: [], trustable: false }
  }
  const list = Array.isArray(args)
    ? args.filter((value): value is string => typeof value === "string")
    : []
  return analyzeLine(list.length > 0 ? [command, ...list].join(" ") : command)
}
