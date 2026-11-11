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
      { t: 'chips', items: [{ verb: 'Edited', path: 'Projects/Atlas/launch-plan.md', diff: '+3 −1', id: 'toolu_demo', backup: 'edit' }, { verb: 'Created', path: 'Projects/Atlas/Status 2026-11-11.md', diff: 'new' }] },
      { t: 'tool', id: 'c', name: 'Edit', verb: 'Edited', rest: ' C:\\Users\\Ali\\Downloads\\quote.txt', status: 'failed', err: 'Blocked by read-only rules', lines: [{ a: 'C:\\Users\\Ali\\Downloads\\quote.txt', b: '' }] },
      { t: 'blocked', path: 'C:\\Users\\Ali\\Downloads\\printer-quote.pdf' }]) ] },
  { id: 'c2', title: 'Weekly review, week 45', when: now - 86400e3, pinned: false, msgs: [{ role: 'user', text: 'Make observations about this week’s notes.', time: '18:02' }, bot([{ t: 'text', text: 'Quiet week: two notes changed, both about Atlas. Where should I keep these observations?\n\n<choices>\n- Save them to Reviews/2026-W45.md\n- Add them to today’s daily note\n- Just keep them in this chat\n</choices>' }])] },
  { id: 'c3', title: 'Lisbon trip notes', when: now - 20 * 86400e3, pinned: false, msgs: [{ role: 'user', text: 'Where did I write about Lisbon?', time: '20:41' }, bot([{ t: 'text', text: 'In Travel.' }])] }];
const THEME = process.env.THEME === 'light' ? 'light' : 'dark';
const cfg = { vaultWin: 'C:\\Users\\alijas\\Documents\\Vault', claudePath: '/home/alijas/.local/bin/claude', readScope: 'machine', name: 'Ali', vaultName: 'Vault', vaultWsl: '/mnt/c/Users/alijas/Documents/Vault',
  theme: THEME, textSize: 'regular', model: '', effort: '', models: ['haiku', 'sonnet', 'opus', 'fable'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'], summonOk: true, keys: {},
  projects: [{ name: 'rook', path: '/home/alijas/note_taking_assistant' }], schedule: { dailyDays: [3, 4], weeklyDay: 4, weeklyHour: 16 } };
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
for (const [c, f] of Object.entries({ 'config:get': () => cfg, 'config:set': (_, x) => Object.assign(cfg, x), 'vault:recent': () => all.slice(0, 4), 'vault:list': () => all.slice().sort((a, b) => a.file.localeCompare(b.file)),
  'vault:graph': () => graph,
  'note:resolve': (_, name) => (all.find((n) => n.title.toLowerCase() === String(name).toLowerCase()) || {}).file || null,
  'note:read': (_, rel) => ({ file: rel, content: rel.includes('Atlas launch') ? noteText : '# ' + rel + '\n\nA short note that links to [[Atlas launch plan]].', mtimeMs: now - 2 * 3600e3 }),
  'vault:info': () => ({ ok: true, notes: 1284, folders: 96 }), 'chats:load': () => chats, 'chats:save': () => true, 'note:open': () => true, 'app:version': () => '0.2.0', 'update:get': () => ({ state: 'available', version: '0.5.0' }),
  'vault:search': (_, q) => all.filter((n) => n.file.toLowerCase().includes(String(q).toLowerCase())).slice(0, 6).concat([{ ...all[3], snippet: 'Printer quote — waiting on a revised figure for ' + q }]),
  'attach:save': (_, { name }) => 'Attachments/' + name, 'schedule:runWeekly': () => ({ ok: true }),
  'change:get': () => ({ hasBackup: true, before: '# Atlas launch plan\n\nThe plan for shipping Atlas.\n\n## Still open\n\n- Printer quote\n- Cover typeface licence\n- Launch date\n\n## Notes\n\nNothing yet.\n', now: '# Atlas launch plan\n\nThe plan for shipping Atlas.\n\n## Still open\n\n- Printer quote, revised figure due Friday\n- Cover typeface licence\n- Launch date\n- Confirm proof dates with Sam\n\n## Notes\n\nNothing yet.\n' }),
  'change:revert': () => true, 'attach:discard': () => true,
  'voice:status': () => ({ installed: false, installing: false, percent: 0, sizeMb: 157 }), 'voice:install': () => ({ ok: true }), 'voice:remove': () => true, 'voice:transcribe': () => 'hello from the microphone' }))
  ipcMain.handle(c, f);
ipcMain.on('config:initial', (e) => { e.returnValue = { theme: THEME, textSize: 'regular' }; });
['voice:start', 'attach:sent', 'chat:send', 'chat:cancel', 'clipboard:write', 'update:check', 'update:download', 'update:install', 'win:mini', 'win:minimize', 'win:maximize', 'win:close'].forEach((c) => ipcMain.on(c, () => {}));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ width: 980, height: 760, frame: false, show: true, backgroundColor: THEME === 'light' ? '#F7F3EC' : '#131211',
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true } });
  const errors = [];
  w.webContents.on('console-message', (_e, lvl, msg) => { errors.push(lvl + ': ' + msg); });
  w.webContents.on('preload-error', (_e, p, err) => errors.push('preload: ' + err));
  await w.loadFile(path.join(__dirname, '../src/index.html'));
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(out, n + '.png'), (await w.webContents.capturePage()).toPNG()); };
  const js = (c) => w.webContents.executeJavaScript(c).catch((e) => { errors.push('js: ' + e.message); });
  const notes = []; // results of the behaviour checks below
  const check = async (label, expr) => notes.push(`${label}: ${JSON.stringify(await js(expr))}`);
  const key = (init) => js(`document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true }, ${JSON.stringify(init)})))`);
  const P = THEME === 'light' ? 'L-' : '';
  const snap = (n) => shot(P + n);
  await wait(100); await snap('0a-splash');
  await wait(2200); await snap('1-home');
  await js(`[...document.querySelectorAll('#view-home .row')].find(b=>b.textContent.includes('Atlas: what')).click()`); await wait(300);
  await js(`document.getElementById('scroller').scrollTop = 0`); await snap('2-chat');
  await js(`document.getElementById('scroller').scrollTop = 99999`); await snap('3-chat-bottom');
  // change viewer
  await js(`document.querySelector('.chip-act').click()`); await wait(300); await snap('3b-changes');
  await check('diff lines (add, del)', `[document.querySelectorAll('.diff-line.add').length, document.querySelectorAll('.diff-line.del').length]`);
  await key({ key: 'Escape' }); await check('modal closed by Esc', `document.getElementById('modal-layer').classList.contains('hidden')`);
  // answer buttons
  await js(`document.querySelector('.back-link').click()`); await wait(200);
  await js(`[...document.querySelectorAll('#view-home .row')].find(b=>b.textContent.includes('Weekly review')).click()`); await wait(300); await snap('3c-choices');
  await check('choices', `[...document.querySelectorAll('.choice')].map(b=>b.textContent)`);
  await check('choices block hidden from text', `!document.querySelector('.msg-bot').textContent.includes('<choices>')`);
  // search palette
  await key({ key: 'K', code: 'KeyK', ctrlKey: true }); await wait(200);
  await js(`{const i=document.querySelector('.pal-input'); i.value='atlas'; i.dispatchEvent(new Event('input'))}`); await wait(500); await snap('3d-palette');
  await check('palette groups', `[...document.querySelectorAll('.pal-group')].map(g=>g.textContent)`);
  await key({ key: 'Escape' });
  // slash command and the /agent popup
  await js(`{const a=document.getElementById('ask'); a.focus(); a.value='/'; a.dispatchEvent(new Event('input'))}`); await wait(200); await snap('3e-slash');
  await js(`document.getElementById('ask').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await wait(300); await snap('3f-agent');
  await js(`[...document.querySelectorAll('#ask-pop .segmented button')].find(b=>b.textContent==='Opus').click()`); await wait(200);
  await js(`{const r=document.querySelector('.pop-range'); r.value='3'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change'))}`); await wait(300); await snap('3g-agent-set');
  await check('hint after /agent', `document.querySelector('.hint-btn').textContent`);
  notes.push('saved model/effort: ' + cfg.model + '/' + cfg.effort);
  await key({ key: 'Escape' }); await check('popup closed by Esc', `document.getElementById('ask-pop').classList.contains('hidden')`);
  // attachments
  await js(`addFiles([new File(['x'], 'quote.pdf', { type: 'application/pdf' }), new File(['y'], 'image.png', { type: 'image/png' })])`); await wait(400); await snap('3h-attach');
  await check('attachments', `ATTACH.map(a=>a.name.replace(/\\d/g,'#'))`);
  await js(`ATTACH.length = 0; paintAsk()`);
  // voice: not installed, so pressing the microphone offers the download
  await js(`document.querySelector('#mic-slot .tool-btn').dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, bubbles: true }))`); await wait(300); await snap('3i-voice-setup');
  await check('voice setup shown', `popKind + ' | ' + [...document.querySelectorAll('#ask-pop button')].map(b=>b.textContent||b.getAttribute('aria-label')).join(', ')`);
  await key({ key: 'Escape' });
  // the sound pipeline: one second of audio in, a 16 kHz mono 16-bit WAV out (44-byte header + 32000 bytes)
  await check('recording converts to WAV of length', `toWav(new Blob([wavFrom(new Float32Array(16000).map((_, i) => Math.sin(i / 8) * 0.3))], { type: 'audio/wav' })).then((w) => [w.length, String.fromCharCode(...w.slice(0, 4))])`);
  // notes
  await js(`[...document.querySelectorAll('#topnav button')][1].click()`); await wait(4500); await snap('4-notes-map');
  await js(`[...document.querySelectorAll('.tree-item')].find(b=>b.textContent.includes('Projects')).click()`); await wait(200);
  await js(`[...document.querySelectorAll('.tree-item')].find(b=>b.textContent.startsWith('Atlas')).click()`); await wait(300);
  await js(`[...document.querySelectorAll('.tree-item')].find(b=>b.textContent.trim()==='Atlas launch plan').click()`); await wait(500); await snap('5-note');
  // settings
  await js(`document.querySelector('button[aria-label="Settings"]').click()`); await wait(400);
  await js(`document.getElementById('set-projects').scrollIntoView()`); await snap('10a-settings-projects');
  await js(`document.getElementById('set-voice').scrollIntoView()`); await snap('10b-settings-look');
  await js(`document.getElementById('set-keys').scrollIntoView()`); await snap('10c-settings-keys');
  // schedule: turn Friday on for daily notes; change a shortcut and use it
  await js(`[...document.querySelectorAll('.day-picks button')].find(b=>b.textContent==='Fri').click()`); await wait(200);
  notes.push('daily days after clicking Fri: ' + JSON.stringify(cfg.schedule.dailyDays));
  await js(`document.querySelector('.key-btn[aria-label*="for Settings"]').click()`);
  await key({ key: 'P', code: 'KeyP', metaKey: true, shiftKey: true }); await wait(200);
  notes.push('Settings shortcut saved as: ' + cfg.keys.settings);
  await key({ key: '1', code: 'Digit1', ctrlKey: true }); await wait(200);
  await check('after Ctrl+1 view', `document.querySelector('.view.active').id`);
  await key({ key: 'P', code: 'KeyP', metaKey: true, shiftKey: true }); await wait(200);
  await check('after Win+Shift+P view', `document.querySelector('.view.active').id`);
  // theme switch from Settings flips the page
  await js(`document.getElementById('set-look').scrollIntoView()`);
  await js(`[...document.querySelectorAll('#set-look .segmented button')].find(b=>b.textContent==='${THEME === 'light' ? 'Dark' : 'Light'}').click()`); await wait(300);
  await check('theme after switching', `document.documentElement.dataset.theme`);
  await js(`[...document.querySelectorAll('#set-look .segmented button')].find(b=>b.textContent==='${THEME === 'light' ? 'Light' : 'Dark'}').click()`); await wait(300);
  await js(`[...document.querySelectorAll('#set-look .segmented button')].find(b=>b.textContent==='Large').click()`); await wait(400); await snap('10d-large-text');
  await js(`[...document.querySelectorAll('#set-look .segmented button')].find(b=>b.textContent==='Regular').click()`); await wait(300);
  // side chat: conversation, saved chats, greeting; then the bar
  await js(`[...document.querySelectorAll('#topnav button')][0].click()`);
  await js(`document.querySelector('#topbar-tools button[aria-label="Side chat"]').click()`);
  w.setMinimumSize(340, 420); w.setSize(400, 720); await wait(300); await snap('12-panel-chat');
  await js(`document.querySelector('#panel-tools button[aria-label="Saved chats"]').click()`); await wait(200); await snap('12b-panel-chats');
  await check('panel list rows', `document.querySelectorAll('#view-home .row').length`);
  await js(`document.querySelector('#panel-tools button[aria-label="New conversation"]').click()`); await snap('13-panel-home');
  w.setMinimumSize(420, 72); w.setSize(420, 72); await snap('11-compact');
  fs.writeFileSync(path.join(out, P + 'checks.txt'), notes.join('\n'));
  fs.writeFileSync(path.join(out, P + 'errors.txt'), errors.join('\n') || 'none');
  app.quit();
});
