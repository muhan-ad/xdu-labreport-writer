'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('schoolPortal', {
  action: (name, payload) => ipcRenderer.invoke('school-portal-action', name, payload),
  onState: callback => ipcRenderer.on('school-portal-state', (_, state) => callback(state)),
  onBlocked: callback => ipcRenderer.on('school-portal-blocked', () => callback()),
  onDownloadBlocked: callback => ipcRenderer.on('school-portal-download-blocked', () => callback()),
});
