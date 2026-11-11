const { contextBridge, ipcRenderer, webFrame } = require('electron');
// Theme and text size are fetched before the page draws, so it never flashes the wrong ones.
const ZOOM = { small: 0.9, regular: 1, large: 1.12 };
let initial = { theme: 'dark', textSize: 'regular' };
try { initial = ipcRenderer.sendSync('config:initial') || initial; } catch { /* defaults */ }
webFrame.setZoomFactor(ZOOM[initial.textSize] || 1);
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  send: (prompt, sessionId) => ipcRenderer.send('chat:send', { prompt, sessionId }),
  cancel: () => ipcRenderer.send('chat:cancel'),
  onEvent: (cb) => ipcRenderer.on('chat:event', (_, ev) => cb(ev)),
  getConfig: inv('config:get'), setConfig: inv('config:set'), pickFolder: inv('dialog:pickFolder'),
  vaultInfo: inv('vault:info'), recentNotes: inv('vault:recent'),
  listNotes: inv('vault:list'), graph: inv('vault:graph'), resolveNote: inv('note:resolve'), readNote: inv('note:read'), version: inv('app:version'),
  openNote: inv('note:open'), openExternal: inv('ext:open'),
  saveNote: inv('note:save'), undoCreate: inv('note:undoCreate'),
  loadChats: inv('chats:load'), saveChats: inv('chats:save'),
  update: { get: inv('update:get'), check: () => ipcRenderer.send('update:check'), download: () => ipcRenderer.send('update:download'), install: () => ipcRenderer.send('update:install'),
            onStatus: (cb) => ipcRenderer.on('update:status', (_, s) => cb(s)) },
  initial,
  setTextSize: (size) => webFrame.setZoomFactor(ZOOM[size] || 1),
  searchNotes: inv('vault:search'), attach: inv('attach:save'),
  change: { get: inv('change:get'), revert: inv('change:revert') },
  voice: () => ipcRenderer.send('voice:start'),
  runWeekly: inv('schedule:runWeekly'),
  onSummon: (cb) => ipcRenderer.on('app:summon', () => cb()),
  onSchedule: (cb) => ipcRenderer.on('schedule:event', (_, ev) => cb(ev)),
  copy: (t) => ipcRenderer.send('clipboard:write', t),
  win: { minimize: () => ipcRenderer.send('win:minimize'), maximize: () => ipcRenderer.send('win:maximize'),
         close: () => ipcRenderer.send('win:close'), mini: (mode) => ipcRenderer.send('win:mini', mode || false) }
});
