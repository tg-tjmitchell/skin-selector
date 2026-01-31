const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	requestFocus: () => ipcRenderer.send('focus-window')
});
