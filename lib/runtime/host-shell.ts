/**
 * The shell that `shell_run` actually uses. Node runs a command line in
 * `cmd.exe` on Windows (or whatever `ComSpec` points at) and in `/bin/sh`
 * everywhere else. The model is told this up front so it does not spend
 * extra turns probing bash, PowerShell, Git Bash, or WSL.
 */

const UNIX_ONLY_COMMANDS = new Set([
  "awk",
  "bash",
  "basename",
  "cat",
  "chmod",
  "chown",
  "clear",
  "diff",
  "dirname",
  "egrep",
  "env",
  "export",
  "fgrep",
  "find",
  "grep",
  "head",
  "id",
  "less",
  "ln",
  "ls",
  "printenv",
  "ps",
  "pwd",
  "realpath",
  "sed",
  "sh",
  "source",
  "tail",
  "tee",
  "touch",
  "tr",
  "uname",
  "wc",
  "which",
  "xargs",
  "zsh",
])

export interface HostShell {
  platform: NodeJS.Platform
  /** Name the model should use, such as Windows or macOS. */
  os: string
  /** Program that interprets a `shell_run` command line. */
  interpreter: string
  /** One short instruction so the first command matches this computer. */
  guidance: string
}

export function hostOsName(platform: NodeJS.Platform): string {
  if (platform === "win32") return "Windows"
  if (platform === "darwin") return "macOS"
  if (platform === "linux") return "Linux"
  return platform
}

/** Program Node uses for `spawn(..., { shell: true })` on this platform. */
export function shellInterpreter(platform: NodeJS.Platform, comSpec?: string): string {
  if (platform !== "win32") return "/bin/sh"
  const base = (comSpec ?? "").split(/[/\\]/).pop()?.trim().toLowerCase() ?? ""
  if (base === "" || base === "cmd.exe" || base === "cmd") return "cmd.exe"
  if (base === "powershell.exe" || base === "powershell" || base === "pwsh.exe" || base === "pwsh") {
    return "PowerShell"
  }
  return base
}

export function hostShellGuidance(os: string, interpreter: string): string {
  if (interpreter === "cmd.exe") {
    return `This computer is ${os}. shell_run command lines already run in cmd.exe. Use cmd.exe syntax (dir, type, findstr, %VAR%). Do not look for bash, Git Bash, WSL, or PowerShell.`
  }
  if (interpreter === "PowerShell") {
    return `This computer is ${os}. shell_run command lines already run in PowerShell. Use PowerShell syntax. Do not look for bash, Git Bash, WSL, or cmd.exe.`
  }
  if (interpreter === "/bin/sh") {
    return `This computer is ${os}. shell_run command lines already run in /bin/sh (POSIX). Use POSIX syntax (ls, cat, grep, $VAR%). Do not use cmd.exe or PowerShell.`
  }
  return `This computer is ${os}. shell_run command lines already run in ${interpreter}. Use that shell's syntax. Do not retry the command in a different shell.`
}

/** The operating system and shell for the process that is running BlackAgents. */
export function hostShell(
  platform: NodeJS.Platform = process.platform,
  comSpec: string | undefined = platform === "win32" ? process.env.ComSpec ?? process.env.comspec : undefined
): HostShell {
  const os = hostOsName(platform)
  const interpreter = shellInterpreter(platform, comSpec)
  return { platform, os, interpreter, guidance: hostShellGuidance(os, interpreter) }
}

/** True when the first token is a Unix command that cmd.exe does not provide. */
export function unixOnlyCommand(command: string): boolean {
  const token = command.trim().split(/\s+/)[0] ?? ""
  const base = token.replace(/^.*[/\\]/, "").replace(/\.exe$/i, "").toLowerCase()
  return UNIX_ONLY_COMMANDS.has(base)
}
