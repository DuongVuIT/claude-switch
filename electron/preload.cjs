const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('claudeSwitch', {
  load: () => ipcRenderer.invoke('workspace:load'),
  desktopLoad: () => ipcRenderer.invoke('desktop:load'),
  desktopCreate: name => ipcRenderer.invoke('desktop:create', name),
  desktopRename: (id, name) => ipcRenderer.invoke('desktop:rename', id, name),
  desktopSwitch: (id, options) => ipcRenderer.invoke('desktop:switch', id, options),
  desktopRecover: () => ipcRenderer.invoke('desktop:recover'),
  desktopReveal: id => ipcRenderer.invoke('desktop:reveal', id),
  createProfile: name => ipcRenderer.invoke('profile:create', name),
  activate: id => ipcRenderer.invoke('profile:activate', id),
  transcript: (key, offset) => ipcRenderer.invoke('session:read', key, offset),
  launch: args => ipcRenderer.invoke('terminal:launch', args),
  copyCommand: args => ipcRenderer.invoke('session:copy-command', args),
  backup: () => ipcRenderer.invoke('backup:create'),
  revealBackup: id => ipcRenderer.invoke('backup:reveal', id),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  onBackupProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('backup:progress', listener);
    return () => ipcRenderer.removeListener('backup:progress', listener);
  }
});
