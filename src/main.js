const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildPolicy, SYSTEM_PROMPT } = require('./policy');
const { resolveInside } = require('./guard');

const DEFAULTS = {
  vaultWin: 'C:\\Users\\alijas\\Documents\\Vault',
  claudePath: '/home/alijas/.local/bin/claude',
  readScope: 'machine', // 'machine' | 'vault'
  name: 'Ali'
};
const userFile = (n) => path.join(app.getPath('userData'), n);
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

const loadCfg = () => ({ ...DEFAULTS, ...readJson(userFile('config.json'), {}) });
const toWsl = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
const fromWsl = (p) => p.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
const vaultName = (cfg) => path.basename(cfg.vaultWin.replace(/[\\/]+$/, ''));
const publicCfg = () => { const c = loadCfg(); return { ...c, vaultName: vaultName(c), vaultWsl: `/${toWsl(c.vaultWin)}` }; };

// ---- vault index (read-only walk) -------------------------------------------------
let walkCache = { at: 0, root: '', files: [] };
function walkVault(root) {
  if (walkCache.root === root && Date.now() - walkCache.at < 4000) return walkCache.files;
  const files = [];
  const stack = [''];
  while (stack.length && files.length < 20000) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(r);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        try { files.push({ rel: r, mtimeMs: fs.statSync(path.join(root, r)).mtimeMs }); } catch { /* vanished */ }
      }
    }
  }
  walkCache = { at: Date.now(), root, files };
  return files;
}
const noteView = (f) => {
  const i = f.rel.lastIndexOf('/');
  return { file: f.rel, title: f.rel.slice(i + 1).replace(/\.md$/i, ''), folder: i < 0 ? '' : f.rel.slice(0, i + 1), mtimeMs: f.mtimeMs };
};

const createdByApp = new Set(); // rel paths of notes this app created (so Undo can remove them)

// ---- window ------------------------------------------------------------------------
let win, child, savedBounds = null;
function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 760, minWidth: 820, minHeight: 600, frame: false, title: 'Vault Assistant',
    backgroundColor: '#f3f2f2', icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
}

const sender = (e) => e.sender;
ipcMain.handle('config:get', () => publicCfg());
ipcMain.handle('config:set', (_, c) => {
  const cur = loadCfg();
  const next = {
    vaultWin: typeof c.vaultWin === 'string' && c.vaultWin.trim() ? c.vaultWin.trim() : cur.vaultWin,
    claudePath: typeof c.claudePath === 'string' && c.claudePath.trim() ? c.claudePath.trim() : cur.claudePath,
    readScope: c.readScope === 'vault' ? 'vault' : 'machine',
    name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 40) : cur.name
  };
  fs.writeFileSync(userFile('config.json'), JSON.stringify(next, null, 2));
  walkCache.at = 0;
  return publicCfg();
});
ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('vault:info', (_, dir) => {
  const root = typeof dir === 'string' && dir ? dir : loadCfg().vaultWin;
  try {
    const st = fs.statSync(root);
    if (!st.isDirectory()) return { ok: false, reason: 'That path is not a folder.' };
    if (!fs.existsSync(path.join(root, '.obsidian'))) return { ok: false, reason: 'No .obsidian folder here, so this is not an Obsidian vault.' };
    walkCache.at = 0;
    const files = walkVault(root);
    const folders = new Set(files.map((f) => f.rel.split('/').slice(0, -1).join('/')));
    return { ok: true, notes: files.length, folders: folders.size };
  } catch { return { ok: false, reason: 'That folder could not be found.' }; }
});
ipcMain.handle('vault:recent', () => {
  const root = loadCfg().vaultWin;
  return walkVault(root).slice().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 4).map(noteView);
});
ipcMain.handle('vault:search', (_, q) => {
  const root = loadCfg().vaultWin;
  const needle = String(q || '').toLowerCase().trim();
  if (!needle) return [];
  return walkVault(root).filter((f) => f.rel.toLowerCase().includes(needle))
    .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 8).map(noteView);
});

ipcMain.handle('note:open', (_, file) => {
  const name = vaultName(loadCfg());
  const f = String(file || '').replace(/\.md$/i, '');
  return shell.openExternal(`obsidian://open?vault=${encodeURIComponent(name)}&file=${encodeURIComponent(f)}`);
});
ipcMain.handle('ext:open', (_, url) => {
  if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url));
});
ipcMain.handle('note:save', (_, { title, content }) => {
  const cfg = loadCfg();
  const base = String(title || 'Note').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Note';
  let rel = `Inbox/${base}.md`;
  for (let n = 2; fs.existsSync(path.join(cfg.vaultWin, rel)); n++) rel = `Inbox/${base} ${n}.md`;
  const abs = resolveInside(cfg.vaultWin, rel); // guard: refuses anything outside the vault
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(content), { flag: 'wx' });
  createdByApp.add(rel);
  walkCache.at = 0;
  return rel;
});
ipcMain.handle('note:undoCreate', (_, rel) => {
  if (!createdByApp.has(rel)) return false; // only ever removes what this app just made
  const cfg = loadCfg();
  fs.unlinkSync(resolveInside(cfg.vaultWin, rel));
  createdByApp.delete(rel);
  walkCache.at = 0;
  return true;
});

ipcMain.handle('chats:load', () => readJson(userFile('chats.json'), []));
ipcMain.handle('chats:save', (_, chats) => {
  if (!Array.isArray(chats)) return false;
  fs.writeFileSync(userFile('chats.json'), JSON.stringify(chats));
  return true;
});
ipcMain.on('clipboard:write', (_, text) => clipboard.writeText(String(text)));

ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win.close());
ipcMain.on('win:mini', (_, on) => {
  if (on) {
    savedBounds = win.getBounds();
    win.setMinimumSize(366, 72);
    win.setResizable(false);
    win.setBounds({ x: savedBounds.x, y: savedBounds.y, width: 366, height: 72 });
    win.setAlwaysOnTop(true);
  } else {
    win.setAlwaysOnTop(false);
    win.setResizable(true);
    win.setMinimumSize(820, 600);
    if (savedBounds) win.setBounds(savedBounds);
  }
});

// ---- chat: Claude Code CLI inside WSL ----------------------------------------------
ipcMain.on('chat:cancel', () => child && child.kill());
ipcMain.on('chat:send', (e, { prompt, sessionId }) => {
  const cfg = loadCfg();
  const vaultWsl = toWsl(cfg.vaultWin);
  const emit = (ev) => { if (!sender(e).isDestroyed()) sender(e).send('chat:event', ev); };

  // Policy lives outside the vault so the agent cannot modify it.
  const policyFile = userFile('policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(buildPolicy(vaultWsl, cfg.readScope), null, 2));

  const args = ['--cd', `/${vaultWsl}`, '-e', cfg.claudePath, '-p',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--settings', `/${toWsl(policyFile)}`,
    '--append-system-prompt', SYSTEM_PROMPT(`/${vaultWsl}`, cfg.readScope)];
  if (sessionId) args.push('--resume', sessionId);

  child = spawn('wsl.exe', args, { windowsHide: true });
  child.stdin.end(prompt); // prompt via stdin avoids quoting problems

  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      // Tell the UI whether a Write targets an existing note (Edited vs Created).
      if (ev.type === 'assistant') {
        for (const b of ev.message?.content || []) {
          if (b.type === 'tool_use' && b.name === 'Write' && b.input?.file_path) {
            b.existed = fs.existsSync(fromWsl(b.input.file_path));
          }
        }
      }
      walkCache.at = 0;
      emit(ev);
    }
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString('utf8'); });
  child.on('error', (er) => emit({ type: 'done', code: -1, stderr: String(er) }));
  child.on('close', (code) => emit({ type: 'done', code, stderr: code ? err.trim() : '' }));
});

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
    try { require('electron-updater').autoUpdater.checkForUpdatesAndNotify(); } catch { /* offline or no release yet */ }
  }
});
app.on('window-all-closed', () => app.quit());
