const path = require("node:path")
const { spawn } = require("node:child_process")
const { app, BrowserWindow, dialog, shell } = require("electron")
const log = require("electron-log/main")

const {
  getAvailablePort,
  isSafeExternalUrl,
  waitForServer,
} = require("./server-utils.cjs")

let applicationServer = null
let applicationUrl = null

log.initialize()

function stopApplicationServer() {
  if (applicationServer && !applicationServer.killed) {
    applicationServer.kill()
  }
  applicationServer = null
}

async function startApplicationServer() {
  const developmentUrl = process.env.ELECTRON_START_URL
  if (developmentUrl) return developmentUrl

  const port = await getAvailablePort()
  const url = `http://127.0.0.1:${port}`
  const serverEntry = path.join(process.resourcesPath, "server", "server.js")

  applicationServer = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: "inherit",
  })

  applicationServer.once("exit", (code, signal) => {
    applicationServer = null
    if (!app.isQuitting) {
      log.error("Application server exited unexpectedly", { code, signal })
      dialog.showErrorBox(
        "BlackAgents server stopped",
        `The local application server exited unexpectedly (${signal ?? code ?? "unknown"}).`
      )
      app.quit()
    }
  })

  await waitForServer(url)
  log.info(`Application server ready at ${url}`)
  return url
}

function openExternal(url) {
  if (isSafeExternalUrl(url)) void shell.openExternal(url)
}

async function createWindow() {
  if (!applicationUrl) applicationUrl = await startApplicationServer()

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "BlackAgents",
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const applicationOrigin = new URL(applicationUrl).origin

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: "deny" }
  })

  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === applicationOrigin) return
    event.preventDefault()
    openExternal(url)
  })

  window.once("ready-to-show", () => window.show())
  await window.loadURL(applicationUrl)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady()
    .then(createWindow)
    .catch((error) => {
      log.error("Desktop startup failed", error)
      dialog.showErrorBox(
        "BlackAgents could not start",
        error instanceof Error ? error.message : String(error)
      )
      app.quit()
    })
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on("before-quit", () => {
  app.isQuitting = true
  stopApplicationServer()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
