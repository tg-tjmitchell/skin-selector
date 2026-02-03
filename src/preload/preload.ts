import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  requestFocus: () => ipcRenderer.send("focus-window")
});
