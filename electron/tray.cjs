const path = require("node:path")

function trayIconFileName(platform = process.platform) {
  return platform === "darwin" ? "trayTemplate.png" : "tray.png"
}

function trayIconPath(directory, platform = process.platform) {
  return path.join(directory, trayIconFileName(platform))
}

function trayMenuTemplate(onOpen, onListen) {
  return [
    { label: "Open", click: onOpen },
    { label: "Start listening", click: onListen ?? onOpen },
    { type: "separator" },
    { role: "quit" },
  ]
}

module.exports = {
  trayIconFileName,
  trayIconPath,
  trayMenuTemplate,
}
