const { execFile } = require("node:child_process")
const path = require("node:path")
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
  utilityProcess,
} = require("electron")
const log = require("electron-log/main")

const {
  getAvailablePort,
  isSafeExternalUrl,
  waitForServer,
} = require("./server-utils.cjs")
const { detectCallApp } = require("./call-apps.cjs")
const { allowsMeetingPermission, systemAudioMode } = require("./capture.cjs")
const { trayIconPath, trayMenuTemplate } = require("./tray.cjs")

let applicationServer = null
let applicationUrl = null
let tray = null
let openingWindow = null

log.initialize()

function stopApplicationServer() {
  if (!applicationServer) return
  applicationServer.kill()
  applicationServer = null
}

async function startApplicationServer() {
  const developmentUrl = process.env.ELECTRON_START_URL
  if (developmentUrl) return developmentUrl

  const port = await getAvailablePort()
  const url = `http://127.0.0.1:${port}`
  const serverEntry = path.join(process.resourcesPath, "server", "server.js")

  // Spawning the Electron binary makes macOS show the Next server as a second Dock icon.
  // A utility process uses the hidden helper app, so only BlackAgents stays visible.
  applicationServer = utilityProcess.fork(serverEntry, [], {
    cwd: path.dirname(serverEntry),
    serviceName: "BlackAgents Server",
    stdio: "inherit",
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
      BLACK_AGENTS_DESKTOP: "1",
    },
  })

  applicationServer.once("exit", (code) => {
    applicationServer = null
    if (!app.isQuitting) {
      log.error("Application server exited unexpectedly", { code })
      dialog.showErrorBox(
        "BlackAgents server stopped",
        `The local application server exited unexpectedly (${code ?? "unknown"}).`
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

function showWindow(window) {
  if (process.platform === "win32") window.setSkipTaskbar(false)
  // Hidden from the minimized state, the window stays minimized until restore.
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function hideWindowToTray(window) {
  if (process.platform === "win32") window.setSkipTaskbar(true)
  window.hide()
}

function showOrCreateWindow() {
  const existing = BrowserWindow.getAllWindows()[0]
  if (existing) {
    showWindow(existing)
    return Promise.resolve()
  }
  if (!openingWindow) {
    openingWindow = createWindow().finally(() => {
      openingWindow = null
    })
  }
  return openingWindow
}

function loadTrayImage() {
  const image = nativeImage.createFromPath(trayIconPath(__dirname))
  if (image.isEmpty()) throw new Error("Tray icon is missing")
  if (process.platform === "darwin") image.setTemplateImage(true)
  return image
}

function setTrayListening(on) {
  if (!tray) return
  tray.setToolTip(on ? "BlackAgents is listening" : "BlackAgents")
  if (process.platform === "darwin") tray.setTitle(on ? "Listening" : "")
}

function allowMeetingCapture() {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowsMeetingPermission(permission))
  })
  if (systemAudioMode(process.platform) !== "loopback") return
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ["screen"] })
      .then((sources) => {
        if (!sources[0]) {
          callback({})
          return
        }
        callback({ video: sources[0], audio: "loopback" })
      })
      .catch(() => callback({}))
  })
}

function execText(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 4000, maxBuffer: 1_000_000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout))
    })
  })
}

async function readCallLines() {
  const processes = await execText("ps", ["-ax", "-o", "comm="])
  if (process.platform !== "darwin") return processes.split(/\r?\n/)
  const titles = await execText("osascript", [
    "-e",
    'tell application "System Events" to get name of every window of (every process whose background only is false)',
  ])
  return `${processes}\n${titles}`.split(/\r?\n/)
}

function offerCallApp(appName) {
  const visible = BrowserWindow.getAllWindows().filter((window) => window.isVisible())
  if (visible.length === 0) {
    const note = new Notification({ title: "BlackAgents", body: `${appName} is open. Start listening?` })
    note.on("click", () => openListening())
    note.show()
    return
  }
  for (const window of visible) window.webContents.send("call-app", appName)
}

function watchCallApps() {
  let offered = null
  const tick = () => {
    void readCallLines().then((lines) => {
      const appName = detectCallApp(lines)
      if (!appName) {
        offered = null
        return
      }
      if (appName === offered) return
      offered = appName
      offerCallApp(appName)
    })
  }
  const timer = setInterval(tick, 20_000)
  if (typeof timer.unref === "function") timer.unref()
  setTimeout(tick, 4_000)
}

function openListening() {
  void showOrCreateWindow().then(() => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window && applicationUrl) void window.loadURL(`${applicationUrl}/meetings?listen=1`)
  })
}

function createApplicationTray() {
  tray = new Tray(loadTrayImage())
  tray.setToolTip("BlackAgents")
  const menu = Menu.buildFromTemplate(
    trayMenuTemplate(
      () => void showOrCreateWindow(),
      () => openListening()
    )
  )

  if (process.platform === "darwin") {
    tray.setIgnoreDoubleClickEvents(true)
    tray.on("click", () => void showOrCreateWindow())
    tray.on("right-click", () => {
      tray?.popUpContextMenu(menu)
    })
    return
  }

  tray.setContextMenu(menu)
  tray.on("click", () => void showOrCreateWindow())
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
      preload: path.join(__dirname, "preload.cjs"),
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

  window.on("minimize", (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault()
    hideWindowToTray(window)
  })

  window.once("ready-to-show", () => window.show())
  await window.loadURL(applicationUrl)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    void showOrCreateWindow()
  })

  app.whenReady()
    .then(() => {
      allowMeetingCapture()
      ipcMain.on("meeting-listening", (_event, on) => setTrayListening(Boolean(on)))
      watchCallApps()
      createApplicationTray()
      return showOrCreateWindow()
    })
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
  if (app.isQuitting || !app.isReady()) return
  void showOrCreateWindow()
})

app.on("before-quit", () => {
  app.isQuitting = true
  tray?.destroy()
  tray = null
  stopApplicationServer()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
