import path from "path";
import fs from "fs";
import { app, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from "electron";
import { autoUpdater } from "electron-updater";
import { startServer, type ServerState } from "./index";
import { isPortableVersion, checkForPortableUpdate, openReleasesPage } from "./portable-updater";

let mainWindow: BrowserWindow | null = null;
let serverInfo: ServerState | null = null;

const windowStateFile = path.join(app.getPath("userData"), "windowState.json");

/**
 * Retrieve saved window state (size and position) from persistent storage.
 * Returns null if no saved state exists or if reading fails.
 */
function getWindowState(): { width: number; height: number; x: number; y: number } | null {
  try {
    if (fs.existsSync(windowStateFile)) {
      return JSON.parse(fs.readFileSync(windowStateFile, "utf-8"));
    }
  } catch (err) {
    console.error("Error reading window state:", err);
  }
  return null;
}

/**
 * Persist the current window state (size and position) to storage.
 */
function saveWindowState(): void {
  if (!mainWindow) return;
  const [width, height] = mainWindow.getSize();
  const [x, y] = mainWindow.getPosition();
  const state = { width, height, x, y };
  try {
    fs.writeFileSync(windowStateFile, JSON.stringify(state), "utf-8");
  } catch (err) {
    console.error("Error saving window state:", err);
  }
}

/**
 * Create and initialize the application's main browser window.
 */
function createWindow(port: number): void {
  const savedState = getWindowState();
  const defaultWidth = 1100;
  const defaultHeight = 780;

  const windowConfig: BrowserWindowConstructorOptions = {
    width: savedState?.width ?? defaultWidth,
    height: savedState?.height ?? defaultHeight,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0b0f1a",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  if (savedState?.x !== undefined && savedState?.y !== undefined) {
    windowConfig.x = savedState.x;
    windowConfig.y = savedState.y;
  }

  mainWindow = new BrowserWindow(windowConfig);

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on("resized", saveWindowState);
  mainWindow.on("moved", saveWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Handle window focus requests. Restores the window from minimized state
 * and brings it to the front temporarily to overcome focus prevention,
 * then releases alwaysOnTop to allow users to click away to other windows.
 */
ipcMain.on("focus-window", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true);
  // Release alwaysOnTop after a brief moment to avoid blocking other windows
  setTimeout(() => {
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(false);
    }
  }, 150);
});

ipcMain.on("open-releases-page", () => {
  openReleasesPage();
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

app.whenReady().then(async () => {
  const port = Number(process.env.PORT) || 3000;
  serverInfo = await startServer({ port, isElectron: true });
  createWindow(serverInfo.port);

  const isPortable = isPortableVersion();
  console.log(`Running as ${isPortable ? "portable" : "installed"} version`);
  
  if (isPortable) {
    // Check GitHub releases manually for portable version
    console.log("Portable mode: using manual update check");
    checkForPortableUpdate()
      .then((updateInfo) => {
        if (updateInfo.updateAvailable && mainWindow) {
          console.log(`Portable update available: ${updateInfo.latestVersion}`);
          mainWindow.webContents.send("portable-update-available", {
            currentVersion: updateInfo.currentVersion,
            latestVersion: updateInfo.latestVersion,
            downloadUrl: updateInfo.downloadUrl
          });
        } else {
          console.log("No portable updates available");
        }
      })
      .catch((err) => {
        console.log("Portable update check failed:", err.message);
      });
  } else {
    // Use electron-updater for installed versions
    autoUpdater.autoDownload = true;
    // Manually control installation to prevent race conditions
    autoUpdater.autoInstallOnAppQuit = false;
    
    autoUpdater.on("checking-for-update", () => {
      console.log("Checking for updates...");
      if (mainWindow) {
        mainWindow.webContents.send("update-checking");
      }
    });
    
    autoUpdater.on("update-available", (info) => {
      console.log("Update available:", info.version);
      if (mainWindow) {
        mainWindow.webContents.send("update-available", info.version);
      }
    });
    
    autoUpdater.on("update-not-available", () => {
      console.log("No updates available");
    });
    
    autoUpdater.on("download-progress", (progressObj) => {
      const percent = Math.round(progressObj.percent);
      console.log(`Download progress: ${percent}%`);
      if (mainWindow) {
        mainWindow.webContents.send("update-progress", percent);
      }
    });
    
    autoUpdater.on("update-downloaded", (info) => {
      console.log("Update downloaded:", info.version);
      if (mainWindow) {
        mainWindow.webContents.send("update-downloaded", info.version);
      }
      
      // Install immediately after download to prevent user launching
      // the app before update is installed (isSilent=true, isForceRunAfter=true)
      setTimeout(() => {
        console.log("Installing update and restarting...");
        autoUpdater.quitAndInstall(true, true);
      }, 500);
    });
    
    autoUpdater.on("error", (err) => {
      console.error("Auto-updater error:", err);
    });
    
    // Check for updates (won't throw if offline)
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.log("Update check failed:", err.message);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(serverInfo?.port ?? port);
    }
  });
});

app.on("before-quit", (event) => {
  // Prevent quitting immediately to allow cleanup of resources
  if (serverInfo) {
    event.preventDefault();
    saveWindowState();
    
    (async () => {
      try {
        if (serverInfo?.lcu) {
          await serverInfo.lcu.disconnect();
        }
        
        if (serverInfo?.server) {
          await new Promise<void>((resolve) => {
            serverInfo!.server.close(() => {
              console.log("Server closed");
              resolve();
            });
          });
        }
      } catch (error) {
        console.error("Error during shutdown:", error);
      } finally {
        serverInfo = null;
        app.quit();
      }
    })();
  } else {
    saveWindowState();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
