// Dev tool: renders the real UI with sample data and saves screenshots. `npx electron --no-sandbox scripts/shot.js <outDir>`
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'); const path = require('path');
const out = process.argv[process.argv.length - 1];
const now = Date.now();
const notes = [
  { file: 'Daily/2026-11-11.md', title: '11 November 2026', folder: 'Daily/', mtimeMs: now },
  { file: 'Projects/Atlas/launch-plan.md', title: 'Atlas launch plan', folder: 'Projects/Atlas/', mtimeMs: now - 2 * 3600e3 },
  { file: 'Meetings/1-1 with Sam.md', title: '1-1 with Sam', folder: 'Meetings/', mtimeMs: now - 2 * 86400e3 },
  { file: 'Reading/research-methods.md', title: 'Research methods — reading notes', folder: 'Reading/', mtimeMs: now - 3 * 86400e3 }];
const bot = (blocks) => ({ role: 'bot', time: '14:02', done: true, blocks });
const chats = [
  { id: 'c1', title: 'Atlas: what’s still open', when: now - 3600e3, pinned: true, sessionId: 's', msgs: [
    { role: 'user', text: 'Summarize the Atlas project — what’s still open?', time: '14:00' },
    bot([
      { t: 'tool', id: 'a', name: 'Grep', verb: 'Searched', rest: ' for “Atlas”', status: 'done', lines: [{ a: 'Projects/Atlas/launch-plan.md', b: '6 hits' }] },
      { t: 'tool', id: 'b', name: 'Read', verb: 'Read', rest: ' Projects/Atlas/launch-plan.md', status: 'done', lines: [{ a: 'Projects/Atlas/launch-plan.md', b: '' }] },
      { t: 'text', text: '## Project Atlas — where things stand\n\nYou last touched [[Atlas launch plan]] on Monday. The one decision so far is in [[1-1 with Sam]]:\n\n> Ship the print edition first; the web edition follows once proofs are signed off.\n\n### Still open\n\n- Printer quote — waiting on a **revised figure**\n- Cover typeface licence for the web\n- Launch date, pending `proofs`\n\n### This week\n\n- [x] Send final manuscript to the printer\n- [ ] Confirm proof dates with Sam\n\n| Item | Cost |\n| --- | --- |\n| Print run | 4,200 |\n| Proofs | 380 |\n\n```js\nconst launch = plan.filter(t => !t.done);\n```' },
      { t: 'chips', items: [{ verb: 'Created', path: 'Projects/Atlas/Status 2026-11-11.md', diff: 'new' }] },
      { t: 'tool', id: 'c', name: 'Edit', verb: 'Edited', rest: ' C:\\Users\\Ali\\Downloads\\quote.txt', status: 'failed', err: 'Blocked by read-only rules', lines: [{ a: 'C:\\Users\\Ali\\Downloads\\quote.txt', b: '' }] },
      { t: 'blocked', path: 'C:\\Users\\Ali\\Downloads\\printer-quote.pdf' }]) ] },
  { id: 'c2', title: 'Weekly review, week 45', when: now - 86400e3, pinned: false, msgs: [{ role: 'user', text: 'Make observations about this week’s notes.', time: '18:02' }, bot([{ t: 'text', text: 'Quiet week.' }])] },
  { id: 'c3', title: 'Lisbon trip notes', when: now - 20 * 86400e3, pinned: false, msgs: [{ role: 'user', text: 'Where did I write about Lisbon?', time: '20:41' }, bot([{ t: 'text', text: 'In Travel.' }])] }];
const cfg = { vaultWin: 'C:\\Users\\alijas\\Documents\\Vault', claudePath: '/home/alijas/.local/bin/claude', readScope: 'machine', name: 'Ali', vaultName: 'Vault', vaultWsl: '/mnt/c/Users/alijas/Documents/Vault' };
for (const [c, f] of Object.entries({ 'config:get': () => cfg, 'config:set': (_, x) => ({ ...cfg, ...x }), 'vault:recent': () => notes, 'vault:search': (_, q) => notes.filter((n) => n.title.toLowerCase().includes(String(q).toLowerCase())),
  'vault:info': () => ({ ok: true, notes: 1284, folders: 96 }), 'chats:load': () => chats, 'chats:save': () => true, 'note:open': () => true }))
  ipcMain.handle(c, f);
['chat:send', 'chat:cancel', 'clipboard:write', 'win:mini', 'win:minimize', 'win:maximize', 'win:close'].forEach((c) => ipcMain.on(c, () => {}));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ width: 980, height: 760, frame: false, show: true, backgroundColor: '#f3f2f2',
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true } });
  const errors = [];
  w.webContents.on('console-message', (_e, lvl, msg) => { errors.push(lvl + ': ' + msg); });
  w.webContents.on('preload-error', (_e, p, err) => errors.push('preload: ' + err));
  await w.loadFile(path.join(__dirname, '../src/index.html'));
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(out, n + '.png'), (await w.webContents.capturePage()).toPNG()); };
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => { errors.push('js: ' + e.message); });
  await shot('1-home'); if (errors.length) { console.log('ERRORS', errors.join('\n')); }
  await js(`document.querySelector('.pr-side[title], .va-sidebar .pr-side:last-of-type');[...document.querySelectorAll('.va-sidebar .pr-side')].find(b=>b.textContent.includes('Atlas: what')).click()`);
  await shot('2-chat');
  await js(`document.querySelector('.va-pane__scroll').scrollTop = 99999`); await shot('3-chat-bottom');
  await js(`document.querySelector('button[aria-label="Saved chats"]').click()`); await shot('4-chats');
  await js(`document.querySelector('button[aria-label="Saved chats"]').click(); document.querySelector('button[aria-label="Search"]').click()`); await wait(300);
  await js(`const i=document.getElementById('pal-q'); i.value='atlas'; i.dispatchEvent(new Event('input'))`); await shot('5-palette');
  await js(`document.getElementById('pal-q').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.querySelector('button[aria-label="Settings"]').click()`); await shot('6-settings');
  await js(`document.querySelector('dialog').close()`);
  w.setSize(366, 72); await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'m',ctrlKey:true,bubbles:true}))`); await shot('7-mini');
  fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n') || 'none');
  app.quit();
});
