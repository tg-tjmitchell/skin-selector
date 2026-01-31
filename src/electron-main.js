const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const { startServer } = require('./index');

let mainWindow;
let serverInfo;

const windowStateFile = path.join(app.getPath('userData'), 'windowState.json');

function getWindowState() {
  try {
    if (fs.existsSync(windowStateFile)) {
      return JSON.parse(fs.readFileSync(windowStateFile, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading window state:', err);
  }
  return null;
}

function saveWindowState() {
  if (!mainWindow) return;
  const state = {
    width: mainWindow.getSize()[0],
    height: mainWindow.getSize()[1],
    x: mainWindow.getPosition()[0],
    y: mainWindow.getPosition()[1]
  };
  try {
    fs.writeFileSync(windowStateFile, JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.error('Error saving window state:', err);
  }
}

function createWindow(port) {
  const savedState = getWindowState();
  const defaultWidth = 1100;
  const defaultHeight = 780;

  const windowConfig = {
    width: savedState?.width ?? defaultWidth,
    height: savedState?.height ?? defaultHeight,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

  mainWindow.on('resized', saveWindowState);
  mainWindow.on('moved', saveWindowState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('focus-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  const port = Number(process.env.PORT) || 3000;
  serverInfo = await startServer({ port, isElectron: true });
  createWindow(serverInfo.port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(serverInfo.port);
    }
  });
});

app.on('before-quit', () => {
  saveWindowState();
  if (serverInfo && serverInfo.server) {
    serverInfo.server.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
