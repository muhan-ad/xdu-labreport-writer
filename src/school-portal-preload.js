'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('schoolPortal', {
  action: (name, payload) => ipcRenderer.invoke('school-portal-action', name, payload),
  onNotice: callback => ipcRenderer.on('school-portal-notice', (_, message) => callback(message)),
  onState: callback => ipcRenderer.on('school-portal-state', (_, state) => callback(state)),
  onBlocked: callback => ipcRenderer.on('school-portal-blocked', (_, target) => callback(target)),
  onDownloadBlocked: callback => ipcRenderer.on('school-portal-download-blocked', () => callback()),
});
