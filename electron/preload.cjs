const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("blackAgentsDesktop", {
  setListening(on) {
    ipcRenderer.send("meeting-listening", Boolean(on))
  },
})
