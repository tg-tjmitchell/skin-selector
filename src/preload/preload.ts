import { contextBridge, ipcRenderer } from "electron";

/**
 * Type definition for portable update information.
 */
interface PortableUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
}

/**
 * Expose safe IPC methods to the renderer process via the electronAPI global.
 * Provides window management, app info, and update notifications through
 * isolated context bridge to prevent XSS attacks.
 */
contextBridge.exposeInMainWorld("electronAPI", {
  requestFocus: () => ipcRenderer.send("focus-window"),
  openReleasesPage: () => ipcRenderer.send("open-releases-page"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
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
  },
  onPortableUpdateAvailable: (callback: (info: PortableUpdateInfo) => void) => {
    ipcRenderer.on("portable-update-available", (_event, info) => callback(info));
  }
});
