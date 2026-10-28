import { describe, expect, it } from "vitest"

import { K0DING_SYSTEM } from "@/lib/k0ding/prompt"
import { codingTools, type CodingBuffer } from "@/lib/runtime/tools/code"
import { hostOsName, hostShell, shellInterpreter, unixOnlyCommand } from "@/lib/runtime/host-shell"
import { shellFailureMessage } from "@/lib/runtime/tools/shell"

describe("host shell", () => {
  it("names the operating system", () => {
    expect(hostOsName("win32")).toBe("Windows")
    expect(hostOsName("darwin")).toBe("macOS")
    expect(hostOsName("linux")).toBe("Linux")
    expect(hostOsName("freebsd")).toBe("freebsd")
  })

  it("uses cmd.exe on Windows unless ComSpec is another shell", () => {
    expect(shellInterpreter("win32")).toBe("cmd.exe")
    expect(shellInterpreter("win32", "C:\\Windows\\System32\\cmd.exe")).toBe("cmd.exe")
    expect(shellInterpreter("win32", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(
      "PowerShell"
    )
    expect(shellInterpreter("win32", "C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("PowerShell")
    expect(shellInterpreter("darwin")).toBe("/bin/sh")
    expect(shellInterpreter("linux", "ignored")).toBe("/bin/sh")
  })

  it("tells the model the shell it already has, so it does not probe others", () => {
    const windows = hostShell("win32", "C:\\Windows\\System32\\cmd.exe")
    expect(windows.os).toBe("Windows")
    expect(windows.interpreter).toBe("cmd.exe")
    expect(windows.guidance).toContain("already run in cmd.exe")
    expect(windows.guidance).toContain("Do not look for bash, Git Bash, WSL, or PowerShell.")

    const powershell = hostShell("win32", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
    expect(powershell.guidance).toContain("already run in PowerShell")
    expect(powershell.guidance).not.toContain("already run in cmd.exe")

    const mac = hostShell("darwin")
    expect(mac.guidance).toContain("This computer is macOS")
    expect(mac.guidance).toContain("already run in /bin/sh")
    expect(mac.guidance).toContain("Do not use cmd.exe or PowerShell.")

    const gitBash = hostShell("win32", "C:\\Program Files\\Git\\bin\\bash.exe")
    expect(gitBash.interpreter).toBe("bash.exe")
    expect(gitBash.guidance).toContain("already run in bash.exe")
  })

  it("recognizes Unix commands that cmd.exe will reject", () => {
    expect(unixOnlyCommand("ls -la")).toBe(true)
    expect(unixOnlyCommand("cat")).toBe(true)
    expect(unixOnlyCommand("/usr/bin/grep")).toBe(true)
    expect(unixOnlyCommand("npm test")).toBe(false)
    expect(unixOnlyCommand("dir")).toBe(false)
  })

  it("asks for a cmd.exe rewrite only when the failed command was Unix syntax", () => {
    const rejected = {
      exitCode: 1,
      stderr: "'ls' is not recognized as an internal or external command, operable program or batch file.",
      timedOut: false,
    }
    expect(shellFailureMessage(rejected, "ls -la", "cmd.exe")).toContain("Rewrite it with cmd.exe syntax")
    expect(shellFailureMessage(rejected, "npm", "cmd.exe")).toBe(
      "Program not found: npm. Install it or check the PATH."
    )
    expect(shellFailureMessage({ exitCode: 0, stderr: "", timedOut: false }, "ls", "cmd.exe")).toBeUndefined()
    expect(shellFailureMessage({ exitCode: null, stderr: "", timedOut: true }, "ls", "cmd.exe")).toBe(
      "Command timed out"
    )
    expect(
      shellFailureMessage(
        { exitCode: 127, stderr: "ls: command not found", timedOut: false },
        "ls",
        "/bin/sh"
      )
    ).toBe("Program not found: ls. Install it or check the PATH.")
  })

  it("includes the host shell in the assistant tool and in K0ding", () => {
    const guidance = hostShell().guidance
    expect(K0DING_SYSTEM).toContain(guidance)
    const buffer: CodingBuffer = {
      root: { id: "app", path: "C:\\temp\\app", label: "app", hidden: [] },
      changes: [],
    }
    const tool = codingTools(buffer).find((item) => item.name === "shell_run")
    expect(tool?.description).toContain(guidance)
  })
})
