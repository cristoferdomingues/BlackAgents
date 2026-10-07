const path = require("node:path")

function trayIconFileName(platform = process.platform) {
  return platform === "darwin" ? "trayTemplate.png" : "tray.png"
}

function trayIconPath(directory, platform = process.platform) {
  return path.join(directory, trayIconFileName(platform))
}

function trayMenuTemplate(onOpen) {
  return [
    { label: "Open", click: onOpen },
    { type: "separator" },
    { role: "quit" },
  ]
}

module.exports = {
  trayIconFileName,
  trayIconPath,
  trayMenuTemplate,
}
