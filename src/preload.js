const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  send: (prompt, sessionId) => ipcRenderer.send('chat:send', { prompt, sessionId }),
  cancel: () => ipcRenderer.send('chat:cancel'),
  onEvent: (cb) => ipcRenderer.on('chat:event', (_, ev) => cb(ev)),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (c) => ipcRenderer.invoke('config:set', c)
});
