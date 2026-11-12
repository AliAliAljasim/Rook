const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, screen, Tray, Menu, Notification, globalShortcut, nativeTheme, net } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPolicy, SYSTEM_PROMPT } = require('./policy');
const { resolveInside } = require('./guard');
const schedule = require('./schedule');
const voiceEngine = require('./voice');
const scan = require('./vaultscan');
const clip = require('./clip');
const moves = require('./moves');

const DEFAULTS = {
  // vault, CLI path and name are machine-specific: blank until the first-run setup fills them in
  vaultWin: '',
  claudePath: '',
  readScope: 'machine', // 'machine' | 'vault'
  name: '',
  launchAtLogin: true, // start with Windows, quietly in the tray
  notify: true,        // a Windows notification when a reply finishes while Rook is hidden or behind other apps
  keys: {},            // the user's changed shortcuts, { action: 'Ctrl+N' }; defaults live in the renderer
  theme: 'dark',       // 'dark' | 'light' | 'system'
  textSize: 'regular', // 'small' | 'regular' | 'large'
  model: '',           // '' lets the Claude CLI choose; otherwise one of MODELS
  effort: '',          // '' lets the CLI choose; otherwise one of EFFORTS
  projects: [],        // [{ name, path }] folders Rook should know by name (path as WSL sees it)
  // days are 0 (Sunday) to 6; -1 turns the weekly review off; prompts are the user's own: [{ id, name, prompt, days, hour }]
  schedule: { dailyDays: [], weeklyDay: -1, weeklyHour: 16, prompts: [] }
};
const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const SUMMON_DEFAULT = 'Ctrl+Alt+Space';
const CAPTURE_DEFAULT = 'Ctrl+Alt+C';
const KEY_ACTIONS = ['newChat', 'mini', 'settings', 'chat', 'notes', 'tasks', 'search', 'voice', 'summon', 'capture'];
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const cleanProjects = (list) => (Array.isArray(list) ? list : []).slice(0, 30)
  .map((p) => ({ name: String(p?.name || '').replace(/[\r\n"`]/g, ' ').trim().slice(0, 60), path: anyToWsl(String(p?.path || '').replace(/[\r\n"`]/g, '').trim()).slice(0, 300) }))
  .filter((p) => p.name && p.path.startsWith('/'));
const cleanDays = (d) => (Array.isArray(d) ? [...new Set(d.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : []);
function cleanSchedule(x) {
  const wd = Number.isInteger(x?.weeklyDay) && x.weeklyDay >= 0 && x.weeklyDay <= 6 ? x.weeklyDay : -1;
  const wh = Number.isInteger(x?.weeklyHour) && x.weeklyHour >= 0 && x.weeklyHour <= 23 ? x.weeklyHour : 16;
  const seen = new Set();
  const prompts = (Array.isArray(x?.prompts) ? x.prompts : []).slice(0, 12).map((p) => ({
    id: String(p?.id || '').replace(/[^\w-]/g, '').slice(0, 24),
    name: String(p?.name || '').replace(/[\r\n"`]/g, ' ').trim().slice(0, 60),
    prompt: String(p?.prompt || '').trim().slice(0, 4000),
    days: cleanDays(p?.days),
    hour: Number.isInteger(p?.hour) && p.hour >= 0 && p.hour <= 23 ? p.hour : 9
  })).filter((p) => p.id && p.name && p.prompt && p.days.length && !seen.has(p.id) && seen.add(p.id));
  return { dailyDays: cleanDays(x?.dailyDays), weeklyDay: wd, weeklyHour: wh, prompts };
}
const cleanKeys = (k) => Object.fromEntries(Object.entries(k && typeof k === 'object' ? k : {})
  .filter(([a, v]) => KEY_ACTIONS.includes(a) && typeof v === 'string' && /^((Ctrl|Alt|Shift|Win)\+)*[^+\s]{1,12}$/.test(v)));
// Windows starts Rook at sign-in with --hidden, which keeps the window in the tray until it is asked for.
function applyLoginItem(cfg) {
  if (!app.isPackaged) return; // never register the development build
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.launchAtLogin, args: ['--hidden'] }); } catch { /* best effort */ }
}
const userFile = (n) => path.join(app.getPath('userData'), n);
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

// Builds before 0.6.1 shipped one developer's paths as defaults, and saving any setting wrote them to config.json.
// On a PC where that vault is not there, drop them (and the name that came with them) so the setup runs.
const OLD_DEFAULTS = { vaultWin: 'C:\\Users\\alijas\\Documents\\Vault', claudePath: '/home/alijas/.local/bin/claude', name: 'Ali' };
function loadCfg() {
  const c = { ...DEFAULTS, ...readJson(userFile('config.json'), {}) };
  if (c.vaultWin === OLD_DEFAULTS.vaultWin && c.claudePath === OLD_DEFAULTS.claudePath && !fs.existsSync(c.vaultWin)) {
    c.vaultWin = ''; c.claudePath = '';
    if (c.name === OLD_DEFAULTS.name) c.name = '';
  }
  return c;
}
const toWsl = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
// Any path the user might give (C:\\..., \\\\wsl.localhost\\<distro>\\..., or already /home/...) as WSL sees it.
const anyToWsl = (p) => {
  const m = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)?$/i.exec(p);
  if (m) return (m[1] || '\\').replace(/\\/g, '/');
  return /^[A-Za-z]:[\\/]/.test(p) ? `/${toWsl(p)}` : p.replace(/\\/g, '/');
};
const fromWsl = (p) => p.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
const vaultName = (cfg) => path.basename(cfg.vaultWin.replace(/[\\/]+$/, ''));
const needsSetup = (c) => !c.vaultWin || !c.claudePath || !c.name;
const publicCfg = () => { const c = loadCfg(); return { ...c, needsSetup: needsSetup(c), vaultName: c.vaultWin ? vaultName(c) : '', vaultWsl: c.vaultWin ? `/${toWsl(c.vaultWin)}` : '', summonOk, captureOk, models: MODELS, efforts: EFFORTS }; };
let summonOk = true, captureOk = true;

// ---- vault index (read-only walk) -------------------------------------------------
let walkCache = { at: 0, root: '', files: [] };
function walkVault(root) {
  if (!root) return []; // no vault chosen yet: never walk the current directory
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

// ---- link graph + note reading (read-only) -------------------------------------------
const { noteIndex } = scan; // how a [[link]] finds its note
let graphCache = { sig: '', data: null };
function buildGraph(root) {
  const files = walkVault(root);
  const sig = root + '|' + files.length + '|' + files.reduce((a, f) => a + f.mtimeMs, 0);
  if (graphCache.sig === sig) return graphCache.data;
  const resolve = noteIndex(files);
  const idx = new Map(files.map((f, i) => [f.rel, i]));
  const seen = new Set(), edges = [];
  const re = /\[\[([^\]\n]+)\]\]/g;
  files.forEach((f, i) => {
    let text;
    try {
      const abs = path.join(root, f.rel);
      if (fs.statSync(abs).size > 1024 * 1024) return;
      text = fs.readFileSync(abs, 'utf8');
    } catch { return; }
    let m;
    while ((m = re.exec(text))) {
      const to = resolve(m[1]);
      if (!to) continue;
      const j = idx.get(to);
      if (j === i) continue;
      const key = i < j ? i + ':' + j : j + ':' + i;
      if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
    }
  });
  const data = { nodes: files.map((f) => { const v = noteView(f); return { id: v.file, title: v.title, folder: v.folder }; }), edges };
  graphCache = { sig, data };
  return data;
}

const createdByApp = new Set(); // rel paths of notes this app created (so Undo can remove them)

// ---- window ------------------------------------------------------------------------
const isLight = (cfg) => cfg.theme === 'light' || (cfg.theme === 'system' && !nativeTheme.shouldUseDarkColors);
// The page asks for these synchronously before it draws, so it never flashes the wrong theme or size.
ipcMain.on('config:initial', (e) => { const c = loadCfg(); e.returnValue = { theme: isLight(c) ? 'light' : 'dark', textSize: c.textSize }; });
let win, child, savedBounds = null, savedMax = false, miniMode = null;
function createWindow(show = true) {
  win = new BrowserWindow({
    width: 980, height: 760, minWidth: 820, minHeight: 600, frame: false, title: 'Rook', show,
    backgroundColor: isLight(loadCfg()) ? '#F7F3EC' : '#131211', icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
  // Closing the window keeps Rook running in the tray (a reply in progress carries on); Quit is in the tray menu.
  win.on('close', (e) => {
    if (quitting || !tray) return;
    e.preventDefault();
    saveMiniSpot();
    win.hide();
    if (!readJson(userFile('window.json'), {}).trayHintShown) {
      try {
        notifyUser('Rook is still running', 'It stays in the tray by the clock. Right-click its icon to quit.');
        fs.writeFileSync(userFile('window.json'), JSON.stringify({ ...readJson(userFile('window.json'), {}), trayHintShown: true }));
      } catch { /* the hint is optional */ }
    }
  });
}

// ---- background: tray icon, single instance ------------------------------------------
let tray = null, quitting = false, scheduler = null;
function showWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function quitApp() { quitting = true; app.quit(); }
// A Windows notification; clicking it opens Rook.
function notifyUser(title, body) {
  try { const n = new Notification({ title, body }); n.on('click', showWindow); n.show(); } catch { /* notifications are optional */ }
}
// The global shortcut works from any app: it brings Rook forward ready to type, or tucks it away again.
const toAccel = (combo) => combo.split('+').map((p) => (p === 'Ctrl' ? 'Control' : p === 'Win' ? 'Super' : p.startsWith('Arrow') ? p.slice(5) : p)).join('+');
function summon() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused() && tray) return win.hide();
  showWindow();
  win.webContents.send('app:summon');
}
// Capture: from any app, the highlighted text (or, with nothing highlighted, what is on the clipboard) is
// added to today's daily note with the time and the window it came from. No agent run, so it is instant.
function runPs(script, cb) {
  try { execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 }, (err, out) => cb(err ? '' : String(out).trim())); }
  catch { cb(''); }
}
// Reads the front window's title, lets go of the shortcut's modifier keys, then presses Ctrl+C there.
const COPY_PS = '$t=Add-Type -PassThru -Name W -Namespace RookCapture -MemberDefinition \'[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);'
  + '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();'
  + '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);\';'
  + '$sb=New-Object System.Text.StringBuilder 512;[void]$t::GetWindowText($t::GetForegroundWindow(),$sb,512);$z=[System.UIntPtr]::Zero;'
  + 'foreach($k in 0x12,0x10,0x5B){$t::keybd_event($k,0,2,$z)};$t::keybd_event(0x11,0,0,$z);$t::keybd_event(0x43,0,0,$z);$t::keybd_event(0x43,0,2,$z);$t::keybd_event(0x11,0,2,$z);'
  + '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$sb.ToString()';
let capturing = false;
function captureSelection() {
  if (capturing) return;
  capturing = true;
  const tell = (title, body) => {
    capturing = false;
    walkCache.at = 0;
    notifyUser(title, body);
    if (win && !win.isDestroyed()) win.webContents.send('schedule:event', { title, body });
  };
  const file = (text, source) => {
    if (!text.trim()) return tell('Nothing to capture', 'Highlight some text or copy something first.');
    try {
      const now = new Date();
      const { rel, abs } = schedule.ensureDaily(loadCfg(), now, resolveInside);
      const cur = fs.readFileSync(abs, 'utf8');
      fs.appendFileSync(abs, (cur && !cur.endsWith('\n') ? '\n' : '') + schedule.captureEntry(text, source, now));
      tell('Captured to today’s note', `${rel}: ${text.trim().replace(/\s+/g, ' ').slice(0, 90)}`);
    } catch { tell('Could not capture', 'Today’s note could not be written. Check the vault folder in Settings.'); }
  };
  const before = clipboard.readText();
  // With Rook itself in front there is nothing to copy from: take what is already on the clipboard.
  if (win && !win.isDestroyed() && win.isFocused()) return file(before, 'the clipboard');
  const textOnly = clipboard.availableFormats().every((f) => f.startsWith('text/'));
  if (textOnly) clipboard.clear(); // so a fresh copy can be told apart from what was already there
  runPs(COPY_PS, (title) => setTimeout(() => {
    const copied = clipboard.readText();
    const fresh = textOnly ? copied : (copied !== before ? copied : '');
    if (textOnly && before) clipboard.writeText(before); // hand the clipboard back as it was
    file(fresh || before, fresh ? title : 'the clipboard');
  }, 220));
}
function registerSummon() {
  try {
    globalShortcut.unregisterAll();
    const keys = loadCfg().keys;
    summonOk = globalShortcut.register(toAccel(keys.summon || SUMMON_DEFAULT), summon);
    captureOk = globalShortcut.register(toAccel(keys.capture || CAPTURE_DEFAULT), captureSelection);
  } catch { summonOk = false; captureOk = false; }
}
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '..', 'build', 'icon.ico'));
    tray.setToolTip('Rook');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Rook', click: showWindow }, { type: 'separator' }, { label: 'Quit Rook', click: quitApp }]));
    tray.on('click', showWindow);
  } catch { tray = null; /* no tray available: closing the window quits as before */ }
}

const sender = (e) => e.sender;
ipcMain.handle('config:get', () => publicCfg());
ipcMain.handle('config:set', (_, c) => {
  const cur = loadCfg();
  const next = {
    vaultWin: typeof c.vaultWin === 'string' && c.vaultWin.trim() ? c.vaultWin.trim() : cur.vaultWin,
    claudePath: typeof c.claudePath === 'string' && c.claudePath.trim() ? c.claudePath.trim() : cur.claudePath,
    readScope: c.readScope === 'vault' ? 'vault' : 'machine',
    name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 40) : cur.name,
    launchAtLogin: typeof c.launchAtLogin === 'boolean' ? c.launchAtLogin : cur.launchAtLogin,
    notify: typeof c.notify === 'boolean' ? c.notify : cur.notify,
    keys: cleanKeys(c.keys),
    theme: oneOf(c.theme, ['dark', 'light', 'system'], cur.theme),
    textSize: oneOf(c.textSize, ['small', 'regular', 'large'], cur.textSize),
    model: c.model === '' ? '' : oneOf(c.model, MODELS, cur.model),
    effort: c.effort === '' ? '' : oneOf(c.effort, EFFORTS, cur.effort),
    projects: cleanProjects(c.projects),
    schedule: cleanSchedule(c.schedule)
  };
  fs.writeFileSync(userFile('config.json'), JSON.stringify(next, null, 2));
  applyLoginItem(next);
  registerSummon();
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
// ---- first-run setup: suggest this PC's own values ----------------------------------
// Where the Claude CLI lives inside WSL. A login shell so ~/.local/bin and the like are on PATH.
const findClaude = () => new Promise((resolve) => {
  const script = 'command -v claude || for p in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do [ -x "$p" ] && echo "$p" && break; done';
  execFile('wsl.exe', ['-e', 'bash', '-lc', script], { windowsHide: true, timeout: 20000 }, (err, out) => {
    const p = String(out || '').replace(/\0/g, '').trim().split(/\r?\n/).pop() || '';
    resolve({ wsl: !(err && err.code === 'ENOENT'), path: p.startsWith('/') ? p : '' });
  });
});
// Vaults Obsidian already knows about (its own list), then the usual spot in Documents.
function findVaults() {
  const out = [];
  const known = readJson(path.join(app.getPath('appData'), 'obsidian', 'obsidian.json'), {}).vaults || {};
  for (const v of Object.values(known)) if (v && typeof v.path === 'string' && /^[A-Za-z]:\\/.test(v.path) && fs.existsSync(v.path)) out.push(v.path);
  const docs = path.join(app.getPath('documents'), 'Vault');
  if (!out.length) out.push(docs);
  return [...new Set(out)];
}
ipcMain.handle('setup:detect', async () => {
  const claude = await findClaude();
  let user = '';
  try { user = os.userInfo().username || ''; } catch { /* unknown */ }
  return { name: user ? user[0].toUpperCase() + user.slice(1) : '', vaults: findVaults(), claudePath: claude.path, wsl: claude.wsl };
});
// A new vault: the folder and an empty .obsidian, so Obsidian opens it as a vault.
ipcMain.handle('vault:create', (_, dir) => {
  if (typeof dir !== 'string' || !/^[A-Za-z]:\\/.test(dir.trim())) return { ok: false, reason: 'Use a full Windows path, like C:\\Users\\you\\Documents\\Vault.' };
  try { fs.mkdirSync(path.join(dir.trim(), '.obsidian'), { recursive: true }); return { ok: true }; }
  catch (e) { return { ok: false, reason: `Could not create the folder: ${e.message}` }; }
});
// Is the CLI path real? Runs `claude --version` inside WSL.
ipcMain.handle('setup:checkClaude', (_, p) => new Promise((resolve) => {
  if (typeof p !== 'string' || !p.trim().startsWith('/')) return resolve({ ok: false, reason: 'Use the path as WSL sees it, like /home/you/.local/bin/claude.' });
  execFile('wsl.exe', ['-e', p.trim(), '--version'], { windowsHide: true, timeout: 30000 }, (err, out) => {
    resolve(err ? { ok: false, reason: 'Claude did not start from that path. In WSL, run "command -v claude" to find it.' } : { ok: true, version: String(out).trim() });
  });
}));
ipcMain.handle('vault:recent', () => {
  const root = loadCfg().vaultWin;
  return walkVault(root).slice().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 4).map(noteView);
});
ipcMain.handle('vault:list', () => walkVault(loadCfg().vaultWin).map(noteView).sort((a, b) => a.file.localeCompare(b.file, undefined, { sensitivity: 'base', numeric: true })));
ipcMain.handle('vault:graph', () => buildGraph(loadCfg().vaultWin));
ipcMain.handle('note:resolve', (_, name) => noteIndex(walkVault(loadCfg().vaultWin))(name));
ipcMain.handle('note:read', (_, rel) => {
  const cfg = loadCfg();
  if (!/\.md$/i.test(String(rel))) throw new Error('Only notes can be opened.');
  const abs = resolveInside(cfg.vaultWin, String(rel)); // the viewer never reads outside the vault
  const st = fs.statSync(abs);
  if (st.size > 2 * 1024 * 1024) throw new Error('This note is too large to show.');
  return { file: String(rel).replace(/\\/g, '/'), content: fs.readFileSync(abs, 'utf8'), mtimeMs: st.mtimeMs };
});
ipcMain.handle('app:version', () => app.getVersion());
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

// Search: notes whose name matches, then notes whose text matches (with the line it was found on).
ipcMain.handle('vault:search', (_, q) => {
  const root = loadCfg().vaultWin;
  const needle = String(q || '').toLowerCase().trim();
  if (needle.length < 2) return [];
  const files = walkVault(root).slice().sort((a, b) => b.mtimeMs - a.mtimeMs);
  const byName = files.filter((f) => f.rel.toLowerCase().includes(needle)).slice(0, 8);
  const seen = new Set(byName.map((f) => f.rel)), byText = [];
  for (const f of files) {
    if (byText.length >= 8) break;
    if (seen.has(f.rel)) continue;
    let text;
    try { const abs = path.join(root, f.rel); if (fs.statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const at = text.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    const start = text.lastIndexOf('\n', at) + 1, end = text.indexOf('\n', at);
    byText.push({ ...noteView(f), snippet: text.slice(start, end < 0 ? undefined : end).trim().slice(0, 160) });
  }
  return [...byName.map(noteView), ...byText];
});

// Attachments dropped or pasted into the ask box are filed in the vault, where notes can embed them.
ipcMain.handle('attach:save', (_, { name, bytes }) => {
  const cfg = loadCfg();
  const buf = Buffer.from(bytes);
  if (!buf.length || buf.length > 25 * 1024 * 1024) throw new Error('Files up to 25 MB can be attached.');
  let folder = 'Attachments';
  try {
    const set = readJson(path.join(cfg.vaultWin, '.obsidian', 'app.json'), {}).attachmentFolderPath;
    if (typeof set === 'string' && set.trim() && !/^\.?\/?$/.test(set.trim()) && !set.startsWith('./')) folder = set.trim().replace(/^\/+|\/+$/g, '');
  } catch { /* default folder */ }
  const clean = String(name || 'file').replace(/[<>:"/\\|?*#^\[\]\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(-90) || 'file';
  const ext = path.extname(clean), stem = clean.slice(0, clean.length - ext.length) || 'file';
  let rel = `${folder}/${stem}${ext}`;
  for (let n = 2; fs.existsSync(path.join(cfg.vaultWin, rel)); n++) rel = `${folder}/${stem} ${n}${ext}`;
  const abs = resolveInside(cfg.vaultWin, rel); // guard: refuses anything outside the vault
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf, { flag: 'wx' });
  attachedNow.add(rel);
  return rel;
});
// Taking an attachment off a message before sending it: the copy Rook just filed goes to the Recycle Bin.
// Only files saved by attach:save in this session qualify, so nothing else in the vault can be removed this way.
const attachedNow = new Set();
ipcMain.handle('attach:discard', async (_, rel) => {
  if (!attachedNow.has(rel)) return false;
  attachedNow.delete(rel);
  try { await shell.trashItem(resolveInside(loadCfg().vaultWin, rel)); return true; } catch { return false; }
});
ipcMain.on('attach:sent', (_, rels) => { for (const r of Array.isArray(rels) ? rels : []) attachedNow.delete(r); });

// Voice, hold to talk: recorded in the window, transcribed on this PC by whisper.cpp (src/voice.js).
let voice = null;
const getVoice = () => voice || (voice = voiceEngine.create(userFile('voice')));
const voiceProgress = (st) => { if (win && !win.isDestroyed()) win.webContents.send('voice:progress', st); };
ipcMain.handle('voice:status', () => getVoice().status());
ipcMain.handle('voice:install', async () => {
  try { await getVoice().install(voiceProgress); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
});
ipcMain.handle('voice:remove', () => getVoice().remove());
ipcMain.handle('voice:transcribe', (_, wav) => getVoice().transcribe(wav));
// The fallback when the engine is not installed: Windows voice typing (Win+H) on the ask box.
ipcMain.on('voice:start', () => {
  const ps = '$k=Add-Type -PassThru -Name K -Namespace RookKeys -MemberDefinition \'[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);\';'
    + '$z=[System.UIntPtr]::Zero;$k::keybd_event(0x5B,0,0,$z);$k::keybd_event(0x48,0,0,$z);$k::keybd_event(0x48,0,2,$z);$k::keybd_event(0x5B,0,2,$z)';
  // -EncodedCommand (base64, UTF-16) avoids every quoting problem between Node, the command line and PowerShell.
  try { execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true }, () => {}); } catch { /* not on Windows */ }
});

ipcMain.handle('schedule:runWeekly', () => scheduler && scheduler.runWeeklyNow());
ipcMain.handle('schedule:runPrompt', (_, id) => (scheduler ? scheduler.runPromptNow(String(id)) : { ok: false, text: 'The scheduler is not running.' }));

// ---- tasks: every "- [ ]" line in the vault, and ticking one off ------------------------
const readNoteText = (root, rel) => { try { const abs = path.join(root, rel); return fs.statSync(abs).size > 1024 * 1024 ? null : fs.readFileSync(abs, 'utf8'); } catch { return null; } };
ipcMain.handle('tasks:list', () => {
  const root = loadCfg().vaultWin, out = [];
  let count = 0;
  for (const f of walkVault(root)) {
    if (scan.inTemplates(f.rel) || count >= 3000) continue; // a template's checkboxes are not things to do
    const text = readNoteText(root, f.rel);
    if (text == null || !text.includes('[ ]')) continue;
    const tasks = scan.tasksIn(text).filter((t) => !t.done);
    if (tasks.length) { out.push({ ...noteView(f), tasks }); count += tasks.length; }
  }
  return out;
});
ipcMain.handle('tasks:set', (_, t) => {
  const cfg = loadCfg();
  if (!/\.md$/i.test(String(t?.file)) || !Number.isInteger(t?.line) || typeof t?.text !== 'string') return { ok: false };
  const abs = resolveInside(cfg.vaultWin, String(t.file)); // guard: refuses anything outside the vault
  const next = scan.setTask(fs.readFileSync(abs, 'utf8'), { line: t.line, text: t.text, done: !!t.done });
  if (!next) return { ok: false }; // the note changed and that task is no longer there
  fs.writeFileSync(abs, next.content);
  walkCache.at = 0;
  return { ok: true, line: next.line };
});

// ---- health check: broken links, empty notes, notes nothing links to, repeated names ----
function otherFiles(root) {
  const out = [], stack = [''];
  while (stack.length && out.length < 50000) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(r);
      else if (e.isFile() && !e.name.toLowerCase().endsWith('.md')) out.push(r);
    }
  }
  return out;
}
ipcMain.handle('vault:health', () => {
  const root = loadCfg().vaultWin;
  walkCache.at = 0;
  const notes = walkVault(root).map((f) => ({ rel: f.rel, text: readNoteText(root, f.rel) })).filter((n) => n.text != null);
  return scan.health(notes, otherFiles(root));
});
// An empty note goes to the Recycle Bin. It is read again first: a note that has gained text since the check stays.
ipcMain.handle('health:trash', async (_, rel) => {
  if (!/\.md$/i.test(String(rel))) return false;
  const abs = resolveInside(loadCfg().vaultWin, String(rel));
  if (!scan.isEmptyNote(String(rel).replace(/\\/g, '/'), fs.readFileSync(abs, 'utf8'))) return false;
  await shell.trashItem(abs);
  walkCache.at = 0;
  return true;
});
// Creates the note a broken link points to. Undo goes through note:undoCreate.
ipcMain.handle('health:create', (_, { from, target }) => {
  const cfg = loadCfg();
  const rel = scan.linkNotePath(String(from || ''), String(target || ''));
  if (!rel) throw new Error('That link cannot be a file name.');
  const abs = resolveInside(cfg.vaultWin, rel); // guard: refuses anything outside the vault
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `# ${path.basename(rel, '.md')}\n\n`, { flag: 'wx' });
  createdByApp.add(rel);
  walkCache.at = 0;
  return rel;
});

// ---- web clipping: Rook fetches the page; the agent only ever sees its text ------------
ipcMain.handle('clip:fetch', (_, url) => clip.fetchPage(url, (u, o) => net.fetch(u, o)));

ipcMain.handle('chats:load', () => readJson(userFile('chats.json'), []));
ipcMain.handle('chats:save', (_, chats) => {
  if (!Array.isArray(chats)) return false;
  fs.writeFileSync(userFile('chats.json'), JSON.stringify(chats));
  return true;
});
ipcMain.on('clipboard:write', (_, text) => clipboard.writeText(String(text)));

ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => { saveMiniSpot(); win.close(); });
// ---- mini modes: 'bar' (quick-capture strip) and 'panel' (side chat). Each remembers its own spot. ----
const MINI = {
  bar: { width: 420, height: 72, min: [420, 72], resizable: false },
  panel: { width: 400, height: 720, min: [340, 420], resizable: true }
};
function miniBounds(mode) {
  const m = MINI[mode];
  const s = readJson(userFile('window.json'), {})[mode];
  const ok = s && [s.x, s.y].every(Number.isFinite) && screen.getAllDisplays().some(({ workArea: a }) =>
    s.x + m.min[0] > a.x && s.x < a.x + a.width && s.y + m.min[1] > a.y && s.y < a.y + a.height);
  if (ok && mode === 'bar') return { x: s.x, y: s.y, width: m.width, height: m.height };
  if (ok) return { x: s.x, y: s.y, width: Math.max(m.min[0], s.width || m.width), height: Math.max(m.min[1], s.height || m.height) };
  // First time, on the screen the window is on: the bar sits bottom-centre, the side chat docks to the right edge.
  const a = screen.getDisplayMatching(savedBounds).workArea;
  if (mode === 'bar') return { x: a.x + Math.round((a.width - m.width) / 2), y: a.y + a.height - m.height - 24, width: m.width, height: m.height };
  const height = Math.min(m.height, a.height - 24);
  return { x: a.x + a.width - m.width - 12, y: a.y + Math.round((a.height - height) / 2), width: m.width, height };
}
function saveMiniSpot() {
  if (!miniMode) return;
  try {
    const all = readJson(userFile('window.json'), {});
    all[miniMode] = win.getBounds();
    fs.writeFileSync(userFile('window.json'), JSON.stringify(all));
  } catch { /* best effort */ }
}
ipcMain.on('win:mini', (_, mode) => {
  mode = MINI[mode] ? mode : null;
  if (mode === miniMode) return;
  if (miniMode) saveMiniSpot();
  else {
    // A maximized window can't be shrunk or dragged, and its bounds are the whole screen:
    // remember that it was maximized, keep its restored size, and un-maximize before going mini.
    savedMax = win.isMaximized();
    savedBounds = win.getNormalBounds();
    if (savedMax) win.unmaximize();
  }
  miniMode = mode;
  win.setResizable(true);
  if (mode) {
    win.setMinimumSize(...MINI[mode].min);
    win.setBounds(miniBounds(mode));
    win.setResizable(MINI[mode].resizable);
    win.setAlwaysOnTop(true);
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(820, 600);
    if (savedBounds) win.setBounds(savedBounds);
    if (savedMax) win.maximize();
  }
});

// ---- chat: Claude Code CLI inside WSL ----------------------------------------------
ipcMain.on('chat:cancel', () => { if (child) { child.cancelled = true; child.kill(); } });
// The command line for one agent run, shared by chats and scheduled tasks.
function agentArgs(cfg, outputFlags) {
  const vaultWsl = toWsl(cfg.vaultWin);
  // Policy lives outside the vault so the agent cannot modify it.
  const policyFile = userFile('policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(buildPolicy(vaultWsl, cfg.readScope), null, 2));
  const args = ['--cd', `/${vaultWsl}`, '-e', cfg.claudePath, '-p', ...outputFlags,
    '--settings', `/${toWsl(policyFile)}`,
    '--append-system-prompt', SYSTEM_PROMPT(`/${vaultWsl}`, cfg.readScope, {
      home: (/^\/home\/[^/]+/.exec(cfg.claudePath) || [])[0],
      winHome: (/^\/mnt\/[a-z]\/Users\/[^/]+/i.exec(`/${vaultWsl}`) || [])[0],
      projects: cfg.projects
    })];
  // Reading the whole machine: the CLI only lists and searches inside its working directories, so add the
  // filesystem root as one. This does not grant writes: with no allow rule for them, edits and any shell
  // command that creates or changes a file outside the vault are still refused.
  if (cfg.readScope !== 'vault') args.push('--add-dir', '/');
  if (MODELS.includes(cfg.model)) args.push('--model', cfg.model);
  if (EFFORTS.includes(cfg.effort)) args.push('--effort', cfg.effort);
  return args;
}

// Why an agent run cannot start, in words the user can act on; null when it can.
function agentProblem(cfg) {
  if (needsSetup(cfg)) return 'Rook is not set up yet. Open Settings and choose your vault and the Claude CLI path.';
  if (!fs.existsSync(cfg.vaultWin)) return `The vault folder ${cfg.vaultWin} does not exist. Choose another folder in Settings, or create it.`;
  return null;
}

// ---- change history: what a note looked like before the agent touched it ------------
const backupFile = (id) => path.join(userFile('backups'), `${String(id).replace(/[^\w-]/g, '')}.bak`);
function keepBefore(cfg, toolUse) {
  try {
    const abs = resolveInside(cfg.vaultWin, fromWsl(toolUse.input.file_path));
    if (!fs.existsSync(abs)) return 'new';
    if (fs.statSync(abs).size > 1024 * 1024) return null;
    fs.mkdirSync(userFile('backups'), { recursive: true });
    fs.copyFileSync(abs, backupFile(toolUse.id));
    return 'edit';
  } catch { return null; } // outside the vault, or unreadable: nothing to keep
}
function pruneBackups() {
  try {
    for (const f of fs.readdirSync(userFile('backups'))) {
      const p = path.join(userFile('backups'), f);
      if (Date.now() - fs.statSync(p).mtimeMs > 30 * 86400e3) fs.unlinkSync(p);
    }
  } catch { /* no backups yet */ }
}
ipcMain.handle('change:get', (_, { id, rel }) => {
  const cfg = loadCfg();
  const abs = resolveInside(cfg.vaultWin, String(rel));
  const read = (p) => { try { return fs.statSync(p).size > 1024 * 1024 ? null : fs.readFileSync(p, 'utf8'); } catch { return null; } };
  return { before: read(backupFile(id)), now: read(abs), hasBackup: fs.existsSync(backupFile(id)) };
});
// Puts a note back as it was before one change. A note the agent created goes to the Recycle Bin instead.
ipcMain.handle('change:revert', async (_, { id, rel, created }) => {
  const cfg = loadCfg();
  const abs = resolveInside(cfg.vaultWin, String(rel));
  if (fs.existsSync(backupFile(id))) fs.copyFileSync(backupFile(id), abs);
  else if (created && /\.md$/i.test(abs) && fs.existsSync(abs)) await shell.trashItem(abs);
  else return false;
  walkCache.at = 0;
  return true;
});

// ---- moving, renaming, deleting: the agent asks with a <files> block, the app does it ---
// Deleted items go to the Recycle Bin (restored from there; Undo here covers moves and link fixes).
// Every path goes through the guard; nothing is overwritten; hidden folders (.obsidian, .claude) are left alone.
// Notes whose [[links]] are rewritten get a backup first, so one Undo puts everything back.
const relOf = (root, abs) => path.relative(fs.realpathSync.native(root), abs).split(path.sep).join('/');
function filesUnder(abs, rel) {
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => filesUnder(path.join(abs, e.name), `${rel}/${e.name}`));
}
ipcMain.handle('vault:move', async (_, list) => {
  const root = loadCfg().vaultWin;
  const done = [], failed = [], deleted = [], map = [];
  for (const m of (Array.isArray(list) ? list : []).slice(0, 200)) {
    if (m?.op === 'delete') { // to the Recycle Bin, where the user can restore it
      const p = String(m.path || '');
      try {
        if (!moves.okPath(p)) throw new Error('not a path inside the vault');
        const a = resolveInside(root, p);
        if (!fs.existsSync(a)) throw new Error('not found');
        await shell.trashItem(a);
        deleted.push({ path: relOf(root, a) });
      } catch (e) { failed.push({ from: p, to: '', del: true, error: e.message.replace(/^blocked: /, '') }); }
      continue;
    }
    const from = String(m?.from || ''), to = String(m?.to || '');
    try {
      if (!moves.okPath(from) || !moves.okPath(to)) throw new Error('not a path inside the vault');
      const a = resolveInside(root, from), b = resolveInside(root, to);
      if (!fs.existsSync(a)) throw new Error('not found');
      if (fs.existsSync(b)) throw new Error('something is already there');
      if ((b + path.sep).toLowerCase().startsWith((a + path.sep).toLowerCase())) throw new Error('a folder cannot go inside itself');
      const fromRel = relOf(root, a), toRel = relOf(root, b);
      const inside = filesUnder(a, fromRel);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.renameSync(a, b);
      done.push({ from: fromRel, to: toRel });
      for (const f of inside) map.push({ from: f, to: toRel + f.slice(fromRel.length) });
    } catch (e) { failed.push({ from, to, error: e.message.replace(/^blocked: /, '') }); }
  }
  walkCache.at = 0;
  const edited = [];
  if (map.length) {
    for (const f of walkVault(root)) {
      try {
        const abs = resolveInside(root, f.rel);
        if (fs.statSync(abs).size > 1024 * 1024) continue;
        const text = fs.readFileSync(abs, 'utf8'), next = moves.rewriteLinks(text, map);
        if (next === text) continue;
        const id = `mv${Date.now()}${edited.length}`;
        fs.mkdirSync(userFile('backups'), { recursive: true });
        fs.writeFileSync(backupFile(id), text);
        fs.writeFileSync(abs, next);
        edited.push({ rel: f.rel, id });
      } catch { /* unreadable: its links stay as they were */ }
    }
  }
  walkCache.at = 0;
  return { done, failed, edited, deleted };
});
// Undo: links first (at the notes' new places), then each move backwards, last one first.
ipcMain.handle('vault:moveUndo', (_, r) => {
  const root = loadCfg().vaultWin;
  let ok = true;
  for (const e of Array.isArray(r?.edited) ? r.edited : []) {
    try { fs.copyFileSync(backupFile(e.id), resolveInside(root, String(e.rel))); } catch { ok = false; }
  }
  for (const m of (Array.isArray(r?.done) ? r.done : []).slice().reverse()) {
    try {
      if (!moves.okPath(m.from) || !moves.okPath(m.to)) throw new Error('bad path');
      const a = resolveInside(root, m.to), b = resolveInside(root, m.from);
      if (!fs.existsSync(a) || fs.existsSync(b)) throw new Error('changed since');
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.renameSync(a, b);
    } catch { ok = false; }
  }
  walkCache.at = 0;
  return ok;
});

// When a reply finishes and nobody is looking (Rook is in the tray, minimized, or behind other apps), say so.
function tellReplyDone(code, reply) {
  if (!loadCfg().notify || !win || win.isDestroyed()) return;
  const away = !win.isVisible() || win.isMinimized() || (!win.isFocused() && miniMode !== 'panel'); // the side chat stays on top, so it is seen
  if (!away) return;
  if (code) return notifyUser('Rook could not finish', 'Open Rook to see what went wrong.');
  const asks = reply.includes('<choices>');
  const text = moves.splitMoves(reply).text.split('<choices>')[0].replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim();
  notifyUser(asks ? 'Rook has a question for you' : 'Rook has replied', text.length > 180 ? text.slice(0, 179) + '…' : text || 'The reply is ready.');
}

ipcMain.on('chat:send', (e, { prompt, sessionId }) => {
  const cfg = loadCfg();
  const emit = (ev) => { if (!sender(e).isDestroyed()) sender(e).send('chat:event', ev); };
  const unready = agentProblem(cfg);
  if (unready) return emit({ type: 'done', code: -1, stderr: unready });
  const args = agentArgs(cfg, ['--output-format', 'stream-json', '--verbose', '--include-partial-messages']);
  if (sessionId) args.push('--resume', sessionId);

  const proc = child = spawn('wsl.exe', args, { windowsHide: true });
  proc.stdin.end(prompt); // prompt via stdin avoids quoting problems

  let buf = '', reply = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'result' && typeof ev.result === 'string') reply = ev.result;
      // Tell the UI whether a Write targets an existing note (Edited vs Created).
      if (ev.type === 'assistant') {
        for (const b of ev.message?.content || []) {
          if (b.type === 'tool_use' && ['Write', 'Edit', 'MultiEdit'].includes(b.name) && b.input?.file_path) {
            if (b.name === 'Write') b.existed = fs.existsSync(fromWsl(b.input.file_path));
            b.backup = keepBefore(cfg, b); // 'edit' (a copy was kept), 'new' (the note did not exist) or null
          }
        }
      }
      walkCache.at = 0;
      emit(ev);
    }
  });
  let err = '';
  proc.stderr.on('data', (d) => { err += d.toString('utf8'); });
  proc.on('error', (er) => emit({ type: 'done', code: -1, stderr: String(er) }));
  proc.on('close', (code) => {
    emit({ type: 'done', code, stderr: code ? err.trim() : '' });
    if (!proc.cancelled) tellReplyDone(code, reply);
  });
});

// One-time carry-over of settings and saved chats from the app's old name ("Vault Assistant").
function migrateOldData() {
  const old = path.join(app.getPath('appData'), 'Vault Assistant');
  for (const f of ['config.json', 'chats.json']) {
    try { if (!fs.existsSync(userFile(f)) && fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), userFile(f)); } catch { /* best effort */ }
  }
}

// ---- auto-update: GitHub releases of the (private) repo ------------------------------
// The repo is private, so the updater needs a token. It is not stored anywhere: each check
// asks the GitHub CLI inside WSL (`gh auth token`) and keeps the answer in memory only.
let upd = { state: 'idle', version: null, percent: 0, error: null };
let updater = null;
const UPDATE_REPO = { owner: 'AliAliAljasim', repo: 'rook' }; // same as build.publish in package.json (not available once packaged)
function setUpd(patch) {
  upd = { ...upd, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('update:status', upd);
  try { fs.writeFileSync(userFile('update.log'), `${new Date().toISOString()} ${JSON.stringify(upd)}\n`); } catch { /* best effort */ }
}
const ghToken = () => new Promise((resolve) => {
  execFile('wsl.exe', ['-e', 'bash', '-lc', 'gh auth token'], { windowsHide: true, timeout: 20000 },
    (err, out) => resolve(err ? null : (String(out).trim().split(/\s+/).pop() || null)));
});
async function checkUpdates() {
  if (!app.isPackaged) return setUpd({ state: 'dev' });
  if (['checking', 'available', 'downloading', 'ready'].includes(upd.state)) return;
  setUpd({ state: 'checking', error: null });
  try {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = false;        // the user starts it from the "Update available" button
      updater.autoInstallOnAppQuit = true; // a downloaded update is applied the next time Rook closes
      updater.on('update-available', (i) => setUpd({ state: 'available', version: i.version, percent: 0 }));
      updater.on('update-not-available', () => setUpd({ state: 'current' }));
      updater.on('download-progress', (p) => setUpd({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      updater.on('update-downloaded', (i) => setUpd({ state: 'ready', version: i.version, percent: 100 }));
      updater.on('error', (e) => setUpd({ state: 'error', error: String(e && e.message || e).slice(0, 300) }));
    }
    const token = await ghToken();
    if (!token) return setUpd({ state: 'error', error: 'No GitHub sign-in found in WSL. Run "gh auth login" there; the repository is private.' });
    updater.setFeedURL({ provider: 'github', ...UPDATE_REPO, private: true, token });
    await updater.checkForUpdates();
  } catch (e) {
    setUpd({ state: 'error', error: String(e && e.message || e).slice(0, 300) });
  }
}
ipcMain.handle('update:get', () => upd);
ipcMain.on('update:check', () => { checkUpdates(); });
ipcMain.on('update:download', () => {
  if (upd.state !== 'available' || !updater) return;
  setUpd({ state: 'downloading', percent: 0 });
  updater.downloadUpdate().catch((e) => setUpd({ state: 'error', error: String(e && e.message || e).slice(0, 300) }));
});
ipcMain.on('update:install', () => { if (upd.state === 'ready' && updater) { saveMiniSpot(); quitting = true; updater.quitAndInstall(true, true); } });

// Starting Rook again while it is in the tray brings the running one forward instead of opening a second.
// Windows groups taskbar buttons by this id. The installer's shortcuts (and anything pinned from them) carry
// the appId from package.json, so the running app must declare the same one or it shows up as a second icon.
app.setAppUserModelId('com.alialialjasim.rook');
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  if (!primary) return;
  migrateOldData();
  createTray();
  applyLoginItem(loadCfg());
  registerSummon();
  pruneBackups();
  scheduler = schedule.start({
    loadCfg, userFile, readJson, resolveInside,
    // One headless agent run; resolves with what it wrote back.
    runAgent: (prompt) => new Promise((resolve) => {
      const unready = agentProblem(loadCfg());
      if (unready) return resolve({ ok: false, text: unready });
      const c = spawn('wsl.exe', agentArgs(loadCfg(), ['--output-format', 'json']), { windowsHide: true });
      let out = '';
      const timer = setTimeout(() => c.kill(), 20 * 60e3);
      c.stdout.on('data', (d) => { out += d.toString('utf8'); });
      c.on('error', () => { clearTimeout(timer); resolve({ ok: false, text: 'Could not start Claude.' }); });
      c.on('close', (code) => {
        clearTimeout(timer);
        let text = '', sessionId = null;
        try { const r = JSON.parse(out); text = r.result || ''; sessionId = r.session_id || null; } catch { /* not JSON: failed early */ }
        resolve({ ok: code === 0 && !!text, text, sessionId });
      });
      c.stdin.end(prompt);
    }),
    notify: (title, body, extra) => {
      walkCache.at = 0;
      notifyUser(title, body);
      if (win && !win.isDestroyed()) win.webContents.send('schedule:event', { title, body, ...(extra || {}) });
    }
  });
  createWindow(!(tray && process.argv.includes('--hidden')));
  setTimeout(checkUpdates, 8000);
  setInterval(checkUpdates, 4 * 3600e3);
});
app.on('window-all-closed', () => app.quit());
