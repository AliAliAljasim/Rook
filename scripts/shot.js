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
const titles = ['Atlas launch plan', '1-1 with Sam', 'Budget', 'Checklist', 'Printer quote', 'Cover design', 'Web edition', 'Proof schedule', 'Research methods', 'Reading list', 'Weekly review W45', 'Weekly review W44', 'Lisbon trip', 'Packing list', 'Ideas', 'Typefaces', 'Announcement draft', 'Press contacts', 'Interview notes', 'Glossary', 'Inbox', 'Someday', 'Gift ideas', 'Recipes'];
const folders = ['Projects/Atlas/', 'Meetings/', 'Projects/Atlas/', 'Projects/Atlas/', 'Projects/Atlas/', 'Projects/Atlas/', 'Projects/Atlas/', 'Projects/Atlas/', 'Reading/', 'Reading/', 'Reviews/', 'Reviews/', 'Travel/', 'Travel/', '', 'Reading/', 'Projects/Atlas/', 'Projects/Atlas/', 'Meetings/', '', '', '', '', ''];
const all = titles.map((t, i) => ({ file: folders[i] + t + '.md', title: t, folder: folders[i], mtimeMs: now - i * 5 * 3600e3 }));
all.unshift({ file: 'Daily/2026-11-11.md', title: '2026-11-11', folder: 'Daily/', mtimeMs: now });
const E = [[1,2],[1,3],[1,4],[1,5],[1,6],[1,7],[1,8],[1,17],[1,18],[2,5],[2,8],[2,19],[5,3],[6,16],[7,16],[9,10],[9,16],[11,1],[11,12],[11,9],[13,14],[0,1],[0,2],[0,11],[15,1],[15,9],[18,19],[21,15]];
const graph = { nodes: all.map((n) => ({ id: n.file, title: n.title, folder: n.folder })), edges: E };
const noteText = `---
tags: [atlas, launch]
status: active
owner: Ali
---
# Atlas launch plan

The plan for shipping **Atlas**. Decided with [[1-1 with Sam]]: print first, then the [[Web edition]].

> [!note] Decision
> Ship the print edition first; the web edition follows once proofs are signed off.

## Still open

- Printer quote — waiting on a ==revised figure== from [[Printer quote]]
  - follow up Friday
  - compare against [[Budget]]
- Cover typeface licence for the web, see [[Typefaces]] and [[Missing note]]
- Launch date, pending \`proofs\` #atlas

## This week

- [x] Send final manuscript to the printer
- [ ] Confirm proof dates with Sam

| Item | Cost |
| --- | --- |
| Print run | 4,200 |
| Proofs | 380 |

![[cover-draft.png]]
`;
for (const [c, f] of Object.entries({ 'config:get': () => cfg, 'config:set': (_, x) => ({ ...cfg, ...x }), 'vault:recent': () => all.slice(0, 4), 'vault:list': () => all.slice().sort((a, b) => a.file.localeCompare(b.file)),
  'vault:search': (_, q) => all.filter((n) => n.file.toLowerCase().includes(String(q).toLowerCase())).slice(0, 8), 'vault:graph': () => graph,
  'note:resolve': (_, name) => (all.find((n) => n.title.toLowerCase() === String(name).toLowerCase()) || {}).file || null,
  'note:read': (_, rel) => ({ file: rel, content: rel.includes('Atlas launch') ? noteText : '# ' + rel + '\n\nA short note that links to [[Atlas launch plan]].', mtimeMs: now - 2 * 3600e3 }),
  'vault:info': () => ({ ok: true, notes: 1284, folders: 96 }), 'chats:load': () => chats, 'chats:save': () => true, 'note:open': () => true, 'app:version': () => '0.2.0' }))
  ipcMain.handle(c, f);
['chat:send', 'chat:cancel', 'clipboard:write', 'win:mini', 'win:minimize', 'win:maximize', 'win:close'].forEach((c) => ipcMain.on(c, () => {}));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ width: 980, height: 760, frame: false, show: true, backgroundColor: '#131211',
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true } });
  const errors = [];
  w.webContents.on('console-message', (_e, lvl, msg) => { errors.push(lvl + ': ' + msg); });
  w.webContents.on('preload-error', (_e, p, err) => errors.push('preload: ' + err));
  await w.loadFile(path.join(__dirname, '../src/index.html'));
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(out, n + '.png'), (await w.webContents.capturePage()).toPNG()); };
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => { errors.push('js: ' + e.message); });
  await wait(100); await shot('0a-splash');
  await wait(450); await shot('0b-splash');
  await wait(100); await shot('0c-splash-turn');
  await wait(1500); await shot('1-home');
  await js(`[...document.querySelectorAll('#view-home .row')].find(b=>b.textContent.includes('Atlas: what')).click()`); await wait(300);
  await js(`document.getElementById('scroller').scrollTop = 0`); await shot('2-chat');
  await js(`document.getElementById('scroller').scrollTop = 99999`); await shot('3-chat-bottom');
  await js(`[...document.querySelectorAll('#topnav button')][1].click()`); await wait(4500); await shot('4-notes-map');
  await js(`[...document.querySelectorAll('.tree-item')].find(b=>b.textContent.includes('Projects')).click()`); await wait(200);
  await js(`[...document.querySelectorAll('.tree-item')].find(b=>b.textContent.startsWith('Atlas')).click()`); await wait(300);
  await js(`[...document.querySelectorAll('.tree-item')].find(b=>b.textContent.trim()==='Atlas launch plan').click()`); await wait(500); await shot('5-note');
  await js(`[...document.querySelectorAll('.note-acts button')].find(b=>b.textContent.includes('Show on map')).click()`); await wait(1500); await shot('6-show-on-map');
  await js(`{const i=document.getElementById('search-input'); i.value='atlas'; i.dispatchEvent(new Event('input'))}`); await wait(400); await shot('9-search');
  await js(`{const i=document.getElementById('search-input'); i.value=''; i.dispatchEvent(new Event('input')); document.querySelector('button[aria-label="Settings"]').click()}`); await wait(400); await shot('10-settings');
  w.setMinimumSize(366, 72); w.setSize(366, 72); await shot('11-compact');
  fs.writeFileSync(path.join(out, 'errors.txt'), errors.join('\n') || 'none');
  app.quit();
});
