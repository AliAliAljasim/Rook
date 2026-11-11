const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildPolicy, SYSTEM_PROMPT } = require('./policy');

const DEFAULTS = {
  vaultWin: 'C:\\Users\\alijas\\Documents\\Vault',
  claudePath: '/home/alijas/.local/bin/claude'
};
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const loadCfg = () => {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
};
const toWsl = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');

function ensureCalendar(vaultWin) {
  const dir = path.join(vaultWin, 'Calendar');
  const f = path.join(dir, 'calendar.ics');
  if (fs.existsSync(f)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Vault Assistant//EN\r\nEND:VCALENDAR\r\n');
}

let win, child;
function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 760, title: 'Vault Assistant', backgroundColor: '#14161a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('config:get', () => loadCfg());
ipcMain.handle('config:set', (_, c) => { fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2)); return loadCfg(); });

ipcMain.on('chat:cancel', () => child && child.kill());
ipcMain.on('chat:send', (e, { prompt, sessionId }) => {
  const cfg = loadCfg();
  const vaultWsl = toWsl(cfg.vaultWin);
  try { ensureCalendar(cfg.vaultWin); } catch (err) { e.sender.send('chat:event', { type: 'error', text: String(err) }); }

  // Policy lives outside the vault so the agent cannot modify it.
  const policyFile = path.join(app.getPath('userData'), 'policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(buildPolicy(vaultWsl), null, 2));

  const args = ['--cd', `/${vaultWsl}`, '-e', cfg.claudePath, '-p',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--settings', `/${toWsl(policyFile)}`,
    '--append-system-prompt', SYSTEM_PROMPT(`/${vaultWsl}`)];
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
      try { e.sender.send('chat:event', JSON.parse(line)); } catch { /* ignore non-JSON */ }
    }
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString('utf8'); });
  child.on('close', (code) => e.sender.send('chat:event', { type: 'done', code, stderr: code ? err.trim() : '' }));
});

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
    try { require('electron-updater').autoUpdater.checkForUpdatesAndNotify(); } catch { /* offline or no release yet */ }
  }
});
app.on('window-all-closed', () => app.quit());
