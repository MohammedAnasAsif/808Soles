// Exposes a small, fixed API to the page. Nothing else from Node is reachable.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cadence', {
  platform: process.platform,
  netFetch: (req) => ipcRenderer.invoke('net-fetch', req),
  registerMedia: (url, headers) => ipcRenderer.send('register-media', String(url), headers || {}),
  mediaLog: () => ipcRenderer.invoke('media-log'),
  download: (job) => ipcRenderer.invoke('download', job),
  deleteDownload: (file) => ipcRenderer.invoke('delete-download', String(file)),
  onDownloadProgress: (cb) => {
    ipcRenderer.on('download-progress', (_e, p) => cb(p));
  },
  windowControl: (action) => ipcRenderer.send('window-control', action),
});
