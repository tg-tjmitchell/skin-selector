import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  requestFocus: () => ipcRenderer.send("focus-window"),
  onUpdateChecking: (callback: () => void) => {
    ipcRenderer.on("update-checking", callback);
  },
  onUpdateAvailable: (callback: (version: string) => void) => {
    ipcRenderer.on("update-available", (_event, version) => callback(version));
  },
  onUpdateProgress: (callback: (percent: number) => void) => {
    ipcRenderer.on("update-progress", (_event, percent) => callback(percent));
  },
  onUpdateDownloaded: (callback: (version: string) => void) => {
    ipcRenderer.on("update-downloaded", (_event, version) => callback(version));
  }
});
