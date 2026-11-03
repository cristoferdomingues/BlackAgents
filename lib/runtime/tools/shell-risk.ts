import type { ToolRisk } from "../types"

/**
 * Classify a `shell_run` command by what it actually does.
 *
 * The goal is to stop asking for read-only commands (`git status`, `ls`) while
 * keeping the approval card for anything that writes, installs, reaches the
 * network, runs workspace-defined code, or can run arbitrary code. Unknown
 * commands are `exec`, so a new tool never becomes silently trusted.
 *
 * Two extra flags narrow the "auto-approve writes" shortcut:
 *
 * - `projectCode` marks test runners, linters, builds and package scripts.
 *   They are `write` risk, but running them executes code from the workspace,
 *   so `allowWrites` must not skip the card. The user can still remember the
 *   program explicitly ("Always allow npm").
 * - `escapesWorkspace` marks a call whose arguments point outside the
 *   workspace (absolute paths, `~`, home-directory variables, `..`). Reading
 *   outside the project needs the same approval as writing, and neither
 *   `allowWrites` nor persistent trust may skip it.
 *
 * `trustable` is true only for a plain sequence of write-risk programs with no
 * redirects, substitutions or workspace escape. That is the narrow case a
 * workspace can remember ("always allow `mkdir`"), and it never covers an
 * `exec` command.
 */

export interface ShellAnalysis {
  risk: ToolRisk
  /** Every program a segment would run, normalized (lowercase, no path/ext). */
  programs: string[]
  /** True when the whole line is a plain sequence of write-risk programs. */
  trustable: boolean
  /** True when the line runs code defined by the workspace (tests, linters, builds). */
  projectCode: boolean
  /** True when an argument points outside the workspace. */
  escapesWorkspace: boolean
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

/** Script names that run project code but are safe to remember as a write. */
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

/** Git writes that can run hooks from the repository (project code). */
const GIT_HOOK_SUBCOMMANDS = new Set([
  "commit",
  "merge",
  "checkout",
  "switch",
  "cherry-pick",
  "revert",
  "am",
  "pull",
  "clone",
])

const GIT_BRANCH_READ_FLAGS = new Set([
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-v",
  "-vv",
  "--verbose",
  "--list",
  "-l",
  "--show-current",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--format",
])

const GIT_TAG_READ_FLAGS = new Set([
  "-l",
  "--list",
  "-v",
  "--verify",
  "-n",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--format",
  "--sort",
  "--column",
  "--no-column",
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
  projectCode: boolean
  escapesWorkspace: boolean
}

interface RiskResult {
  risk: ToolRisk
  projectCode: boolean
}

/** Home-directory variables that point outside the workspace. */
const HOME_VARIABLE =
  /\$(?:\{)?(?:HOME|USERPROFILE|HOMEPATH|HOMEDRIVE)(?:\})?|%(?:USERPROFILE|HOMEPATH|HOMEDRIVE)%/i

function looksAbsolute(token: string): boolean {
  if (!token) return false
  if (token === "~" || token.startsWith("~/") || token.startsWith("~\\")) return true
  if (HOME_VARIABLE.test(token)) return true
  if (/^[A-Za-z]:[\\/]/.test(token)) return true
  if (token.startsWith("\\\\") || token.startsWith("//")) return true
  return token.startsWith("/")
}

/**
 * True when any argument looks like a path outside the workspace. This is
 * deliberately conservative: a false positive only adds an approval card.
 */
function escapesWorkspace(args: readonly string[]): boolean {
  return args.some((arg) => {
    if (!arg) return false
    // `--output=/tmp/x` hides the path after the first `=`.
    const eq = arg.indexOf("=")
    const value = eq >= 0 ? arg.slice(eq + 1) : arg
    if (looksAbsolute(value)) return true
    return value.split(/[\\/]/).includes("..")
  })
}

function segmentRisk(risk: ToolRisk, program: string | null, projectCode: boolean, args: readonly string[]): Segment {
  const escape = escapesWorkspace(args)
  return {
    risk: escape && risk === "read" ? "write" : risk,
    program,
    projectCode,
    escapesWorkspace: escape,
  }
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

function gitBranchRisk(args: string[]): ToolRisk {
  const rest = args.slice(1)
  if (rest.length === 0) return "read"
  // Listing/query forms never change a ref, even with a positional pattern.
  if (
    rest.some(
      (arg) =>
        arg === "-l" ||
        arg === "--list" ||
        arg === "--show-current" ||
        arg.startsWith("--list=") ||
        GIT_BRANCH_READ_FLAGS.has(arg)
    )
  ) {
    return "read"
  }
  // Mutating flags: delete/move/copy/force/upstream tracking/edit.
  if (rest.some((arg) => /^-[dDmMcCfu]$/.test(arg) || /^-[dDmMcCfu].+/.test(arg))) return "write"
  if (rest.some((arg) => arg.startsWith("--") && !GIT_BRANCH_READ_FLAGS.has(arg.split("=")[0]))) {
    return "write"
  }
  // `git branch <name>` creates a branch.
  if (rest.some((arg) => !arg.startsWith("-"))) return "write"
  return "read"
}

function gitTagRisk(args: string[]): ToolRisk {
  const rest = args.slice(1)
  if (rest.length === 0) return "read"
  // Listing/query forms never create or delete a tag.
  if (
    rest.some(
      (arg) =>
        arg === "-l" ||
        arg === "--list" ||
        arg === "--verify" ||
        arg === "--contains" ||
        arg === "--no-contains" ||
        arg === "--points-at" ||
        arg.startsWith("--list=")
    )
  ) {
    return "read"
  }
  if (rest.some((arg) => /^-[adsfm]$/.test(arg) || /^-[adsfm].+/.test(arg))) return "write"
  if (rest.some((arg) => arg.startsWith("--") && !GIT_TAG_READ_FLAGS.has(arg.split("=")[0]))) {
    return "write"
  }
  // `git tag <name>` creates a tag.
  if (rest.some((arg) => !arg.startsWith("-"))) return "write"
  return "read"
}

function gitSubcommand(args: string[]): { sub?: string; rest: string[] } {
  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (
      arg === "-C" ||
      arg === "-c" ||
      arg === "--git-dir" ||
      arg === "--work-tree" ||
      arg === "--namespace"
    ) {
      i += 2
      continue
    }
    if (
      arg.startsWith("--git-dir=") ||
      arg.startsWith("--work-tree=") ||
      arg.startsWith("--namespace=")
    ) {
      i += 1
      continue
    }
    break
  }
  return { sub: args[i], rest: args.slice(i) }
}

function gitRisk(args: string[]): ToolRisk {
  const { sub, rest } = gitSubcommand(args)
  if (!sub || sub === "--version" || sub === "-v") return "read"
  if (GIT_READ.has(sub)) return "read"
  if (GIT_EXEC.has(sub)) return "exec"
  if (sub === "reflog") {
    return rest[1] === "expire" || rest[1] === "delete" ? "exec" : "read"
  }
  if (sub === "branch") return gitBranchRisk(rest)
  if (sub === "remote") {
    return rest.some((a) =>
      ["add", "remove", "rm", "set-url", "rename", "prune", "update", "set-head"].includes(a)
    )
      ? "write"
      : "read"
  }
  if (sub === "tag") return gitTagRisk(rest)
  if (sub === "config") {
    return rest.some((a) => ["--get", "--get-all", "--list", "-l"].includes(a)) ? "read" : "write"
  }
  if (sub === "stash") {
    return rest[1] === "list" || rest[1] === "show" ? "read" : "write"
  }
  if (GIT_WRITE.has(sub)) return "write"
  return "exec"
}

function packageManagerRisk(program: string, args: string[]): RiskResult {
  const first = args[0]
  // Bare `yarn` is `yarn install`; the others just print help.
  if (!first) return { risk: program === "yarn" ? "exec" : "read", projectCode: false }
  if (first === "--version" || first === "-v") return { risk: "read", projectCode: false }
  if (first === "run" || first === "run-script") {
    const script = args[1]
    // `npm run` with no script lists the available scripts.
    if (!script) return { risk: "read", projectCode: false }
    return SAFE_SCRIPTS.has(script)
      ? { risk: "write", projectCode: true }
      : { risk: "exec", projectCode: true }
  }
  if (first === "test" || first === "t") return { risk: "write", projectCode: true }
  if (first === "exec" || first === "dlx" || first === "x") {
    return { risk: "exec", projectCode: true }
  }
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
    return { risk: "exec", projectCode: false }
  }
  // pnpm/yarn/bun accept a script name without `run`.
  if (program !== "npm" && SAFE_SCRIPTS.has(first)) {
    return { risk: "write", projectCode: true }
  }
  return { risk: "exec", projectCode: true }
}

function runnerRisk(program: string, args: string[]): RiskResult {
  const first = args[0]
  if (first === "--version" || first === "-v" || first === "-V") {
    return { risk: "read", projectCode: false }
  }
  if (program === "tsc") {
    // Type checking still loads the project's tsconfig and plugins.
    return { risk: "write", projectCode: true }
  }
  if (program === "eslint" || program === "prettier") {
    // Linters and formatters read project config even in check-only mode.
    return { risk: "write", projectCode: true }
  }
  if (program === "playwright" || program === "cypress") {
    return first === "install"
      ? { risk: "exec", projectCode: false }
      : { risk: "write", projectCode: true }
  }
  if (program === "node") {
    if (first === "--test") return { risk: "write", projectCode: true }
    return { risk: "exec", projectCode: true }
  }
  if (program === "python" || program === "python3") {
    if (first === "-m" && (args[1] === "pytest" || args[1] === "unittest")) {
      return { risk: "write", projectCode: true }
    }
    return { risk: "exec", projectCode: true }
  }
  if (program === "go") {
    if (!first) return { risk: "read", projectCode: false }
    if (["test", "vet", "fmt", "build"].includes(first)) {
      return { risk: "write", projectCode: true }
    }
    if (["env", "version", "list", "doc", "help"].includes(first)) {
      return { risk: "read", projectCode: false }
    }
    return { risk: "exec", projectCode: true }
  }
  if (program === "cargo") {
    if (!first) return { risk: "read", projectCode: false }
    if (["test", "check", "clippy", "fmt", "build"].includes(first)) {
      return { risk: "write", projectCode: true }
    }
    if (["metadata", "version", "help", "search"].includes(first)) {
      return { risk: "read", projectCode: false }
    }
    return { risk: "exec", projectCode: true }
  }
  if (program === "dotnet") {
    if (!first) return { risk: "read", projectCode: false }
    if (["test", "build", "restore"].includes(first)) {
      return { risk: "write", projectCode: true }
    }
    if (["--version", "--info", "--list-sdks", "--list-runtimes"].includes(first)) {
      return { risk: "read", projectCode: false }
    }
    return { risk: "exec", projectCode: true }
  }
  if (program === "make" || program === "just") {
    // No target runs the default target, which usually builds.
    if (!first) return { risk: "write", projectCode: true }
    return ["test", "check", "lint", "build", "format", "fmt", "typecheck", "verify"].includes(first)
      ? { risk: "write", projectCode: true }
      : { risk: "exec", projectCode: true }
  }
  if (program === "gradle" || program === "gradlew" || program === "mvn") {
    if (!first) return { risk: "write", projectCode: true }
    return ["test", "check", "build", "package", "install"].includes(first)
      ? { risk: "write", projectCode: true }
      : { risk: "exec", projectCode: true }
  }
  // Jest, vitest, mocha, ava, tap and similar test runners run project code.
  return { risk: "write", projectCode: true }
}

function segmentRiskOf(segment: string): Segment {
  const parts = words(segment)
  const raw = parts[0]
  if (!raw) return { risk: "read", program: null, projectCode: false, escapesWorkspace: false }
  const program = normalizeShellProgram(raw)
  if (!program) return { risk: "exec", program: null, projectCode: false, escapesWorkspace: false }
  const args = parts.slice(1)
  if (READ_PROGRAMS.has(program)) {
    if (program === "find" && args.some((a) => /^-(exec|execdir|ok|okdir|delete)$/.test(a))) {
      return segmentRisk("exec", program, false, args)
    }
    if (program === "find" && args.some((a) => /^-(fprint|fprint0|fls|fprintf)$/.test(a))) {
      return segmentRisk("write", program, false, args)
    }
    if (program === "date" && args.some((a) => a === "-s" || a === "--set" || a.startsWith("--set="))) {
      // Setting the system clock is privileged and destructive.
      return segmentRisk("exec", program, false, args)
    }
    if (program === "sort" && args.some((a) => a === "-o" || /^-o./.test(a) || a.startsWith("--output"))) {
      return segmentRisk("write", program, false, args)
    }
    // `uniq INPUT OUTPUT` writes the second path.
    if (program === "uniq" && args.filter((a) => !a.startsWith("-")).length > 1) {
      return segmentRisk("write", program, false, args)
    }
    return segmentRisk("read", program, false, args)
  }
  if (WRITE_PROGRAMS.has(program)) {
    if (
      program === "tar" &&
      args.some(
        (a) =>
          a === "--to-command" ||
          a.startsWith("--to-command=") ||
          a === "--checkpoint-action" ||
          a.startsWith("--checkpoint-action=") ||
          a === "--use-compress-program" ||
          a.startsWith("--use-compress-program=") ||
          a === "-I" ||
          (a.startsWith("-I") && a.length > 2)
      )
    ) {
      // tar can run an arbitrary command for archive entries.
      return segmentRisk("exec", program, false, args)
    }
    return segmentRisk("write", program, false, args)
  }
  if (EXEC_PROGRAMS.has(program)) return segmentRisk("exec", program, false, args)
  if (program === "sed") {
    return segmentRisk(
      args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === "--in-place" || a.startsWith("--in-place="))
        ? "write"
        : "read",
      program,
      false,
      args
    )
  }
  if (program === "git") {
    const risk = gitRisk(args)
    const { sub } = gitSubcommand(args)
    return segmentRisk(
      risk,
      program,
      risk === "write" && GIT_HOOK_SUBCOMMANDS.has(sub ?? ""),
      args
    )
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(program)) {
    const result = packageManagerRisk(program, args)
    return segmentRisk(result.risk, program, result.projectCode, args)
  }
  if (
    [
      "tsc",
      "eslint",
      "prettier",
      "pytest",
      "mypy",
      "ruff",
      "black",
      "flake8",
      "pylint",
      "jest",
      "vitest",
      "mocha",
      "ava",
      "tap",
      "playwright",
      "cypress",
    ].includes(program)
  ) {
    const result = runnerRisk(program, args)
    return segmentRisk(result.risk, program, result.projectCode, args)
  }
  if (
    ["node", "python", "python3", "go", "cargo", "dotnet", "make", "just", "gradle", "gradlew", "mvn"].includes(
      program
    )
  ) {
    const result = runnerRisk(program, args)
    return segmentRisk(result.risk, program, result.projectCode, args)
  }
  return segmentRisk("exec", program, false, args)
}

function emptyAnalysis(risk: ToolRisk): ShellAnalysis {
  return { risk, programs: [], trustable: false, projectCode: false, escapesWorkspace: false }
}

function analyzeLine(line: string): ShellAnalysis {
  const trimmed = line.trim()
  if (!trimmed) return emptyAnalysis("exec")
  const { segments, hasRedirect } = splitSegments(trimmed)
  const hasSubstitution = /`|\$\(/.test(trimmed)
  if (segments.length === 0) return emptyAnalysis("exec")

  const parsed = segments.map(segmentRiskOf)
  let risk: ToolRisk = hasRedirect ? "write" : "read"
  for (const segment of parsed) risk = maxRisk(risk, segment.risk)
  if (hasSubstitution) risk = "exec"

  const programs = parsed
    .map((segment) => segment.program)
    .filter((program): program is string => Boolean(program))
  const projectCode = parsed.some((segment) => segment.projectCode)
  const escapes = parsed.some((segment) => segment.escapesWorkspace)
  const trustable =
    !hasRedirect &&
    !hasSubstitution &&
    !escapes &&
    programs.length === parsed.length &&
    parsed.every((segment) => segment.risk === "write")

  return { risk, programs, trustable, projectCode, escapesWorkspace: escapes }
}

/** Classify a `shell_run` call. Anything unparseable is `exec`. */
export function analyzeShellCommand(command: unknown, args: unknown): ShellAnalysis {
  if (typeof command !== "string" || !command.trim()) {
    return emptyAnalysis("exec")
  }
  const list = Array.isArray(args)
    ? args.filter((value): value is string => typeof value === "string")
    : []
  return analyzeLine(list.length > 0 ? [command, ...list].join(" ") : command)
}
