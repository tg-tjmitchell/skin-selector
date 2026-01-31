const path = require('path');
const { app, BrowserWindow } = require('electron');
const { startServer } = require('./index');

let mainWindow;
let serverInfo;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b0f1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
  if (serverInfo && serverInfo.server) {
    serverInfo.server.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
