// Installs the Electron shell's own runtime dependencies before a desktop run.
//
// electron-builder packages `electron/` as the app directory. When
// `electron/node_modules` is missing, it silently falls back to the web app's
// node_modules and ships an installer that crashes on startup with
// "Cannot find module 'electron-log/main'". This script makes the missing step
// explicit for local runs; `electron/verify-packaged-deps.cjs` guards packaging.

const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const shellDirectory = path.join(__dirname, "..", "electron")

function missingDependencies() {
  const { dependencies = {} } = require(path.join(shellDirectory, "package.json"))
  return Object.keys(dependencies).filter(
    (name) => !fs.existsSync(path.join(shellDirectory, "node_modules", name, "package.json"))
  )
}

function installDependencies() {
  // `npm` is a .cmd shim on Windows, so run it through the command interpreter.
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm"
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm ci --no-audit --no-fund"]
      : ["ci", "--no-audit", "--no-fund"]
  const result = spawnSync(command, args, {
    cwd: shellDirectory,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function main() {
  const missing = missingDependencies()
  if (missing.length === 0) return

  console.log(`Installing the Electron shell dependencies (${missing.join(", ")})...`)
  installDependencies()

  const stillMissing = missingDependencies()
  if (stillMissing.length > 0) {
    console.error(
      `Could not install the Electron shell dependencies: ${stillMissing.join(", ")}.` +
        "\nRun `npm ci --prefix electron` manually and try again."
    )
    process.exit(1)
  }
}

main()
