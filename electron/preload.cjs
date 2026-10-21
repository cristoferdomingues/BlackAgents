const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("blackAgentsDesktop", {
  setListening(on) {
    ipcRenderer.send("meeting-listening", Boolean(on))
  },
  onCallApp(callback) {
    const listener = (_event, app) => callback(String(app))
    ipcRenderer.on("call-app", listener)
    return () => ipcRenderer.removeListener("call-app", listener)
  },
})
