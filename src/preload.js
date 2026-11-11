const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  send: (prompt, sessionId) => ipcRenderer.send('chat:send', { prompt, sessionId }),
  cancel: () => ipcRenderer.send('chat:cancel'),
  onEvent: (cb) => ipcRenderer.on('chat:event', (_, ev) => cb(ev)),
  getConfig: inv('config:get'), setConfig: inv('config:set'), pickFolder: inv('dialog:pickFolder'),
  vaultInfo: inv('vault:info'), recentNotes: inv('vault:recent'), searchNotes: inv('vault:search'),
  listNotes: inv('vault:list'), graph: inv('vault:graph'), resolveNote: inv('note:resolve'), readNote: inv('note:read'), version: inv('app:version'),
  openNote: inv('note:open'), openExternal: inv('ext:open'),
  saveNote: inv('note:save'), undoCreate: inv('note:undoCreate'),
  loadChats: inv('chats:load'), saveChats: inv('chats:save'),
  copy: (t) => ipcRenderer.send('clipboard:write', t),
  win: { minimize: () => ipcRenderer.send('win:minimize'), maximize: () => ipcRenderer.send('win:maximize'),
         close: () => ipcRenderer.send('win:close'), mini: (mode) => ipcRenderer.send('win:mini', mode || false) }
});
