'use strict';
/* Rook renderer: plain JS, no framework. Builds DOM nodes (never injects untrusted HTML). */
const VA = window.api, icon = window.RookIcon, mark = window.RookMark, MD = window.RookMarkdown;
const $ = (id) => document.getElementById(id);

function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'cls') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
const tool = (name, label, onClick, extra) => h('button', { type: 'button', cls: 'tool-btn' + (extra?.on ? ' on' : ''), 'aria-label': label, title: extra?.title || label, onClick, ...(extra?.attrs || {}) }, icon(name));
const pill = (cls, label, onClick, ic) => h('button', { type: 'button', cls, onClick }, ic ? icon(ic, 'sm') : null, label);

// ---------- state ----------
const S = {
  cfg: null, recent: [], all: [], names: new Set(), noteCount: 0, chats: [], cur: null,
  view: 'home', prevView: 'home', streaming: false, mini: false,
  note: null, noteCtx: true, pane: 'map', treeOpen: new Set(), treeFilter: '',
  graph: null, graphStale: true, map: null, mapSel: null, mapFilter: '',
  chatFilter: '', chatTab: 'all', renaming: null, version: '', update: { state: 'idle' }, plist: false
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const num = (n) => Number(n).toLocaleString('en-GB');
function relTime(ms) {
  const d = new Date(ms), now = new Date(), diff = now - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min`;
  if (sameDay(d, now)) return `${Math.round(diff / 3600000)} h`;
  if (diff < 6 * 86400000) return DAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function chatMeta(ms) {
  const d = new Date(ms), now = new Date();
  if (sameDay(d, now)) return clock(d);
  if (now - d < 6 * 86400000) return DAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const chatGroup = (ms) => (sameDay(new Date(ms), new Date()) ? 'Today' : Date.now() - ms < 6 * 86400000 ? 'This week' : 'Earlier');

// ---------- paths ----------
const wslToWin = (p) => String(p).replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
const normWin = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
function vaultRel(winPath) {
  const root = normWin(S.cfg.vaultWin), p = normWin(winPath);
  return p.startsWith(root + '\\') ? winPath.slice(root.length + 1).replace(/\\/g, '/') : null;
}
function displayPath(p) {
  const win = p.startsWith('/') ? wslToWin(p) : p;
  return vaultRel(win) ?? win;
}
const baseName = (name) => String(name).split('#')[0].replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '').trim().toLowerCase();

let saveTimer;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => VA.saveChats(S.chats.slice(0, 200)), 400); }

// ---------- toasts ----------
function toast(text, opts = {}) {
  const el = h('div', { cls: 'toast' + (opts.error ? ' error' : ''), role: opts.error ? 'alert' : 'status' });
  const close = () => { if (!el.isConnected) return; el.classList.add('leaving'); setTimeout(() => el.remove(), 180); };
  el.append(h('span', { cls: 'toast-icon' }, icon(opts.error ? 'alert' : 'check', 'sm')), h('span', { cls: 'toast-text', text }),
    opts.action ? h('button', { type: 'button', cls: 'toast-act', onClick: () => { close(); opts.onAction(); } }, opts.action)
      : h('button', { type: 'button', cls: 'toast-close', 'aria-label': 'Dismiss', onClick: close }, icon('x', 'sm')));
  $('toasts').append(el);
  setTimeout(close, opts.action ? 6000 : 4000);
}

// ---------- notes: open in the viewer ----------
const mdCtx = {
  openNote: (n) => openNote(n), openUrl: (u) => VA.openExternal(u), copy: (t) => VA.copy(t), icon,
  exists: (name) => S.names.has(baseName(name))
};
async function openNote(nameOrFile) {
  try {
    const hit = S.all.find((n) => n.file === nameOrFile);
    const file = hit ? hit.file : await VA.resolveNote(nameOrFile);
    if (!file) { toast(`No note called “${String(nameOrFile).split('#')[0]}” in the vault.`, { error: true }); return; }
    const n = await VA.readNote(file);
    const i = file.lastIndexOf('/');
    S.note = { ...n, title: file.slice(i + 1).replace(/\.md$/i, ''), folder: i < 0 ? '' : file.slice(0, i + 1) };
    S.noteCtx = true;
    let acc = '';
    for (const part of S.note.folder.split('/').filter(Boolean)) { acc += part + '/'; S.treeOpen.add(acc); }
    S.pane = 'note';
    go('notes');
    $('reader').scrollTop = 0;
    ensureGraph().then(() => { if (S.view === 'notes' && S.pane === 'note') paintReader(); });
  } catch (e) { toast('That note could not be opened.', { error: true }); }
}
async function ensureGraph() {
  if (S.graph && !S.graphStale) return S.graph;
  S.graph = await VA.graph(); S.graphStale = false;
  return S.graph;
}
function linkedNotes(file) {
  if (!S.graph) return null;
  const i = S.graph.nodes.findIndex((n) => n.id === file);
  if (i < 0) return [];
  const out = [];
  for (const [a, b] of S.graph.edges) { if (a === i) out.push(S.graph.nodes[b]); else if (b === i) out.push(S.graph.nodes[a]); }
  return out.sort((x, y) => x.title.localeCompare(y.title));
}

// ---------- tool + event handling ----------
function describeTool(name, input = {}) {
  const fp = input.file_path || input.path;
  switch (name) {
    case 'Read': return { verb: 'Read', rest: ' ' + displayPath(fp || ''), lines: [{ a: displayPath(fp || ''), b: '' }] };
    case 'Grep': return { verb: 'Searched', rest: ` for “${input.pattern || ''}”`, lines: [{ a: input.path ? displayPath(input.path) : 'vault', b: input.glob || '' }] };
    case 'Glob': return { verb: 'Listed', rest: ' ' + (input.pattern || ''), lines: [{ a: input.path ? displayPath(input.path) : 'vault', b: '' }] };
    case 'Edit': case 'MultiEdit': return { verb: 'Edited', rest: ' ' + displayPath(fp || ''), lines: [{ a: displayPath(fp || ''), b: '' }] };
    case 'Write': return { verb: 'Wrote', rest: ' ' + displayPath(fp || ''), lines: [{ a: displayPath(fp || ''), b: '' }] };
    case 'Bash': return { verb: 'Ran', rest: ' ' + String(input.description || input.command || '').slice(0, 80), lines: input.command ? [{ a: String(input.command), b: '' }] : [] };
    case 'Skill': return { verb: 'Used skill', rest: ' ' + (input.skill || ''), lines: [] };
    case 'Task': case 'Agent': return { verb: 'Delegated', rest: ' ' + (input.description || ''), lines: [] };
    default: return { verb: name, rest: '', lines: [] };
  }
}
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);
// What a run of tool calls is doing right now, and what it did once finished.
function toolActivity(b) {
  if (b.name === 'Bash') return 'Running a command';
  if (b.name === 'Read') return 'Reading' + b.rest;
  if (b.name === 'Grep' || b.name === 'Glob') return 'Searching';
  if (WRITE_TOOLS.has(b.name)) return 'Writing' + b.rest;
  if (b.name === 'Skill') return 'Running skill' + b.rest;
  return 'Working';
}
function toolSummary(tools) {
  const n = { cmd: 0, read: 0, search: 0, write: 0, skill: 0, other: 0 };
  for (const b of tools) n[b.name === 'Bash' ? 'cmd' : b.name === 'Read' ? 'read' : b.name === 'Grep' || b.name === 'Glob' ? 'search' : WRITE_TOOLS.has(b.name) ? 'write' : b.name === 'Skill' ? 'skill' : 'other']++;
  const pl = (k, one, many) => (n[k] ? `${n[k]} ${n[k] === 1 ? one : many}` : null);
  const parts = [pl('cmd', 'command', 'commands'), pl('search', 'search', 'searches'), pl('read', 'file read', 'files read'),
    pl('write', 'edit', 'edits'), pl('skill', 'skill', 'skills'), pl('other', 'other step', 'other steps')].filter(Boolean);
  return parts.join(', ');
}
const countLines = (s) => (s ? String(s).split('\n').length : 0);
function chipFor(t) {
  const input = t.input || {};
  const rel = vaultRel(wslToWin(input.file_path || ''));
  if (!rel) return null;
  const keep = { id: t.id, backup: t.backup || null };
  if (t.name === 'Write') return { verb: t.existed ? 'Edited' : 'Created', path: rel, diff: t.existed ? `${countLines(input.content)} lines` : 'new', ...keep };
  return { verb: 'Edited', path: rel, diff: `+${countLines(input.new_string)} −${countLines(input.old_string)}`, ...keep };
}
const lastBot = () => S.cur?.msgs.slice().reverse().find((m) => m.role === 'bot');
const lastBlock = (m) => m.blocks[m.blocks.length - 1];

function onEvent(ev) {
  const bot = lastBot();
  if (ev.session_id && S.cur) S.cur.sessionId = ev.session_id;
  if (!bot) return;
  if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta' && !bot.stopped) {
    let b = lastBlock(bot);
    if (!b || b.t !== 'text') { b = { t: 'text', text: '' }; bot.blocks.push(b); }
    b.text += ev.event.delta.text;
  } else if (ev.type === 'assistant' && !bot.stopped) {
    for (const c of ev.message?.content || []) {
      if (c.type !== 'tool_use') continue;
      bot.blocks.push({ t: 'tool', id: c.id, name: c.name, input: c.input, existed: c.existed, backup: c.backup, status: 'running', ...describeTool(c.name, c.input) });
    }
  } else if (ev.type === 'user') {
    for (const c of ev.message?.content || []) {
      if (c.type !== 'tool_result') continue;
      const t = bot.blocks.find((b) => b.t === 'tool' && b.id === c.tool_use_id);
      if (!t) continue;
      const out = typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join(' ');
      if (c.is_error) {
        t.status = 'failed';
        if (/permission|haven't been granted|not allowed|denied|was blocked/i.test(out)) {
          const p = t.input?.file_path || t.input?.path || '';
          t.err = 'Blocked by read-only rules';
          // The "write to vault instead" card is only for refused changes, not refused searches or commands.
          if (WRITE_TOOLS.has(t.name)) bot.blocks.push({ t: 'blocked', path: p ? (p.startsWith('/') ? wslToWin(p) : p) : '' });
        } else t.err = out.slice(0, 200);
      } else {
        t.status = 'done';
        if (t.name === 'Edit' || t.name === 'Write' || t.name === 'MultiEdit') {
          const chip = chipFor(t);
          if (chip) {
            let g = lastBlock(bot);
            if (!g || g.t !== 'chips') { g = { t: 'chips', items: [] }; bot.blocks.push(g); }
            g.items.push(chip);
            loadNotes();
          }
        }
      }
    }
  } else if (ev.type === 'done') {
    S.streaming = false;
    bot.done = true;
    for (const b of bot.blocks) if (b.t === 'tool' && b.status === 'running') b.status = bot.stopped ? 'failed' : 'done';
    if (ev.code && !bot.stopped) bot.error = ev.stderr || `claude exited with code ${ev.code}`;
    S.cur.when = Date.now();
    persist(); loadNotes(); paintAsk();
    installWhenIdle(); // an update that finished downloading mid-reply waited for this
  }
  scheduleChat();
}
VA.onEvent(onEvent);

// ---------- sending ----------
function send(text) {
  text = String(text || '').trim();
  if (S.streaming || (!text && !ATTACH.length)) return;
  const files = takeAttachments();
  if (!text) text = files.length === 1 ? 'Here is a file.' : 'Here are some files.';
  S.plist = false; closePop();
  const about = S.view === 'notes' && S.pane === 'note' && S.note && S.noteCtx ? S.note : null;
  if (!S.cur) {
    S.cur = { id: 'c' + Date.now(), title: text.length > 44 ? text.slice(0, 43) + '…' : text, when: Date.now(), pinned: false, sessionId: null, msgs: [] };
    S.chats.unshift(S.cur);
  }
  S.cur.msgs.push({ role: 'user', text, time: clock(), about: about ? about.title : null, files: files.length ? files.map((f) => f.name) : undefined }, { role: 'bot', time: clock(), blocks: [], done: false });
  S.streaming = true;
  $('ask').value = ''; $('compact-input').value = ''; autogrow();
  const lead = [about ? `[The note "${about.file}" in the vault is open in the viewer; this message is about it.]` : '',
    files.length ? `[Attached files, saved in the vault: ${files.map((f) => f.rel).join(', ')}]` : ''].filter(Boolean).join('\n');
  VA.send(lead ? `${lead}\n\n${text}` : text, S.cur.sessionId);
  persist(); go('home');
  requestAnimationFrame(() => { $('scroller').scrollTop = $('scroller').scrollHeight; });
}
function stop() {
  if (!S.streaming) return;
  const bot = lastBot();
  if (bot) bot.stopped = true;
  VA.cancel(); scheduleChat();
}
function retry() {
  const msgs = S.cur?.msgs;
  if (!msgs || S.streaming || msgs.length < 2) return;
  msgs.pop(); const user = msgs.pop();
  send(user.text);
}
function newChat() {
  if (S.streaming) stop();
  S.plist = false;
  S.cur = null; go('home'); focusAsk();
}
function openChat(c) {
  if (S.streaming && S.cur !== c) stop();
  S.plist = false;
  S.cur = c;
  go('home');
  requestAnimationFrame(() => { $('scroller').scrollTop = $('scroller').scrollHeight; });
}

// ---------- rows ----------
function row(ic, title, sub, time, onClick, opts = {}) {
  return h('button', { type: 'button', cls: 'row' + (opts.on ? ' on' : ''), onClick },
    h('span', { cls: 'row-cover' }, icon(ic, 'sm')),
    h('span', { cls: 'row-meta' }, h('span', { cls: 'row-title' }, title, opts.pinned ? h('span', { cls: 'tag-pin', text: 'Pinned' }) : null), sub ? h('span', { cls: 'row-sub', text: sub }) : null),
    h('span', { cls: 'row-time', text: time || '' }));
}
const noteRow = (n) => row('file', n.title, n.folder || 'Vault', n.mtimeMs ? relTime(n.mtimeMs) : '', () => openNote(n.file));
const chatPreview = (c) => (c.msgs.find((m) => m.role === 'user') || {}).text || '';

// ---------- HOME ----------
function paintHome() {
  const hr = new Date().getHours();
  const part = hr < 5 ? 'evening' : hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
  const quick = [
    ['pen', 'Add to today’s note', 'Append a line to today’s daily note.', 'Add to today’s note: '],
    ['search', 'Find a note', 'Search the vault for what you wrote about something.', 'Find my notes on '],
    ['align', 'Summarize a project', 'Gather what is still open in a project.', 'Summarize the project '],
    ['eye', 'Make observations', 'Spot patterns in this week’s notes.', 'Make observations about this week’s notes.']
  ];
  document.body.dataset.plist = S.mini === 'panel' && S.plist ? '1' : '';
  $('view-home').replaceChildren(
    h('section', { cls: 'hero' }, h('h1', { text: `Good ${part}, ${S.cfg.name}.` }),
      h('p', { text: `${num(S.noteCount)} notes in ${S.cfg.vaultName}. What should we work on?` })),
    h('div', { cls: 'quick-grid' }, quick.map(([ic, t, d, fill]) =>
      h('button', { type: 'button', cls: 'quick', onClick: () => { $('ask').value = fill; autogrow(); paintAsk(); focusAsk(); } },
        h('span', { cls: 'quick-icon' }, icon(ic, 'sm')), h('span', { cls: 'quick-title', text: t }), h('span', { cls: 'quick-desc', text: d })))),
    h('section', { cls: 'sec' }, ...historyNodes()));
}

// ---------- CHAT ----------
let chatQueued = false;
function scheduleChat() { if (chatQueued) return; chatQueued = true; requestAnimationFrame(() => { chatQueued = false; if (S.view === 'home') paintChat(); paintAsk(); }); }
function toolEl(b) {
  const run = b.status === 'running';
  const d = h('details', { cls: 'tool' + (run ? ' running' : '') + (b.status === 'failed' ? ' failed' : '') });
  if (b.open) d.open = true;
  d.addEventListener('toggle', () => { b.open = d.open; });
  const ic = { Read: 'file', Grep: 'search', Glob: 'search', Edit: 'pen', MultiEdit: 'pen', Write: 'pen' }[b.name] || 'chevron';
  d.append(h('summary', null, run ? h('span', { cls: 'spinner', 'aria-hidden': 'true' }) : icon(b.status === 'failed' ? 'alert' : ic, 'sm'),
    h('span', { cls: 'tool-label' }, h('b', { text: b.verb }), b.rest),
    h('span', { cls: 'tool-status', text: run ? 'Running' : b.status === 'failed' ? 'Failed' : 'Done' }), icon('chevron', 'sm tool-chev')));
  const rows = b.lines.slice(); if (b.err) rows.push({ a: b.err, b: '' });
  d.append(h('div', { cls: 'tool-body' }, rows.map((l) => h('div', null, h('span', { text: l.a }), h('span', { text: l.b })))));
  return d;
}
// A run of consecutive tool calls collapses into one line: live activity while running, a tally when done.
function toolGroupEl(tools) {
  const cur = tools.find((b) => b.status === 'running');
  const failed = tools.filter((b) => b.status === 'failed').length;
  const first = tools[0];
  const d = h('details', { cls: 'tool tool-group' + (cur ? ' running' : '') });
  if (first.groupOpen) d.open = true;
  d.addEventListener('toggle', () => { first.groupOpen = d.open; });
  d.append(h('summary', null, cur ? h('span', { cls: 'spinner', 'aria-hidden': 'true' }) : icon('check', 'sm'),
    h('span', { cls: 'tool-label' }, cur ? h('b', { text: toolActivity(cur) + '…' }) : toolSummary(tools)),
    h('span', { cls: 'tool-status', text: cur ? (tools.length > 1 ? `Step ${tools.length}` : '') : failed ? `${failed} failed` : '' }), icon('chevron', 'sm tool-chev')));
  d.append(h('div', { cls: 'tool-group-body' }, tools.map(toolEl)));
  return d;
}
function botEl(m, isLast) {
  const writing = !m.done && !m.stopped;
  const running = m.blocks.some((b) => b.t === 'tool' && b.status === 'running');
  const art = h('article', { cls: 'msg-bot', 'aria-label': 'Rook replied', 'aria-live': writing ? 'polite' : 'off' });
  if (writing) art.append(h('div', { cls: 'status', role: 'status' }, h('span', { cls: 'mini-vinyl', 'aria-hidden': 'true' }, h('span')), running ? 'Working' : 'Writing'));
  let lastText = null;
  let group = null;
  for (const b of m.blocks) {
    if (b.t === 'tool') { if (!group) group = []; group.push(b); continue; }
    if (group) { art.append(toolGroupEl(group)); group = null; }
    if (b.t === 'text') { lastText = MD.render(splitChoices(b.text).text, mdCtx); art.append(lastText); }
    else if (b.t === 'chips') art.append(h('div', { cls: 'chips' }, b.items.map((c) => h('span', { cls: 'chip-wrap' + (c.reverted ? ' reverted' : '') },
      h('button', { type: 'button', cls: 'chip', 'aria-label': `${c.verb} ${c.path}, open note`, onClick: () => openNote(c.path) },
        h('span', { cls: 'chip-verb', text: c.reverted ? 'Undone' : c.verb }), h('span', { cls: 'chip-path', text: c.path }), h('span', { cls: 'chip-diff', text: c.diff })),
      c.id ? h('button', { type: 'button', cls: 'chip chip-act', 'aria-label': `See what changed in ${c.path}`, title: 'See what changed, or undo it', onClick: () => openChanges(c) }, icon('undo', 'sm'), 'Changes') : null))));
    else if (b.t === 'blocked') art.append(h('div', { cls: 'blocked', role: 'note' }, h('span', { cls: 'blocked-icon' }, icon('lock', 'sm')),
      h('div', { cls: 'blocked-body' }, h('span', { cls: 'eyebrow', text: 'Read-only · outside the vault' }),
        h('p', { text: 'Rook can read this file but can’t change it. It can write the result to a new note in your vault instead.' }),
        b.path ? h('span', { cls: 'blocked-path', text: b.path }) : null,
        S.streaming ? null : pill('pill-ghost', 'Write to vault instead', () => send('Write that to a new note inside the vault instead.')))));
  }
  if (group) art.append(toolGroupEl(group));
  if (writing && lastText && lastBlock(m).t === 'text') (lastText.lastElementChild || lastText).append(h('span', { cls: 'caret', 'aria-hidden': 'true' }));
  if (m.stopped) art.append(h('p', { cls: 'stopped', text: 'Stopped' }));
  if (m.error) art.append(h('p', { cls: 'error-line', role: 'alert' }, icon('alert', 'sm'), m.error.slice(0, 300), isLast ? pill('pill-ghost', 'Retry', retry) : null));
  // A question that ended with options: show them as buttons under the latest reply.
  const lastTextBlock = m.blocks.slice().reverse().find((b) => b.t === 'text');
  const choices = isLast && m.done && !m.error && !S.streaming && lastTextBlock ? splitChoices(lastTextBlock.text).choices : [];
  if (choices.length) art.append(h('div', { cls: 'choices', role: 'group', 'aria-label': 'Answers' }, choices.map((c) => h('button', { type: 'button', cls: 'choice', onClick: () => send(c) }, c))));
  if (m.done && !m.error) {
    const text = m.blocks.filter((b) => b.t === 'text').map((b) => splitChoices(b.text).text).join('\n\n');
    if (text) art.append(h('div', { cls: 'msg-acts' },
      tool('copy', 'Copy reply', () => { VA.copy(text); toast('Reply copied.'); }, { title: 'Copy' }),
      tool('filePlus', 'Save reply as a note', () => saveReply(text), { title: 'Save as note' })));
  }
  return art;
}
async function saveReply(text) {
  try {
    const title = (S.cur?.title || 'Reply').replace(/…$/, '');
    const rel = await VA.saveNote({ title, content: `# ${title}\n\n${text}\n` });
    toast(`Saved to ${rel}`, { action: 'Undo', onAction: async () => { await VA.undoCreate(rel); loadNotes(); } });
    loadNotes();
  } catch { toast('Could not save the note.', { error: true }); }
}
function paintChat() {
  const sc = $('scroller');
  const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  const wrap = [h('button', { type: 'button', cls: 'back-link', onClick: newChat }, icon('back'), 'Home'), h('h1', { cls: 'sr', text: S.cur.title })];
  S.cur.msgs.forEach((m, i) => {
    if (m.role === 'user') wrap.push(h('article', { cls: 'msg-user', 'aria-label': `You said, ${m.time}` },
      m.about ? h('span', { cls: 'msg-about' }, icon('file', 'sm'), m.about) : null,
      (m.files || []).map((f) => h('span', { cls: 'msg-about' }, icon('clip', 'sm'), f)), h('p', { text: m.text })));
    else wrap.push(botEl(m, i === S.cur.msgs.length - 1));
  });
  $('view-chat').replaceChildren(...wrap);
  if (near) sc.scrollTop = sc.scrollHeight;
}

// ---------- NOTES ----------
function buildTree() {
  const root = { folders: new Map(), notes: [], count: 0 };
  for (const n of S.all) {
    const parts = n.file.split('/'); let cur = root; root.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur.folders.has(parts[i])) cur.folders.set(parts[i], { folders: new Map(), notes: [], count: 0, path: parts.slice(0, i + 1).join('/') + '/' });
      cur = cur.folders.get(parts[i]); cur.count++;
    }
    cur.notes.push(n);
  }
  return root;
}
function paintTree() {
  if (!$('tree-tools').firstChild) {
    const inp = h('input', { type: 'search', placeholder: 'Filter notes', 'aria-label': 'Filter notes', autocomplete: 'off', spellcheck: 'false' });
    inp.addEventListener('input', () => { S.treeFilter = inp.value; paintTree(); });
    $('tree-tools').append(h('label', { cls: 'filter' }, icon('search', 'sm'), inp), h('div', { id: 'pane-seg' }));
  }
  $('pane-seg').replaceChildren(seg([['note', 'Note'], ['map', 'Map']], S.pane, (v) => { S.pane = v; paintTree(); paintPane(); }, 'Show'));
  const noteItem = (n, depth) => h('button', { type: 'button', cls: 'tree-item' + (S.note?.file === n.file ? ' on' : ''), style: `padding-left:${8 + depth * 16}px`, title: n.file, onClick: () => openNote(n.file) },
    icon('file', 'sm'), h('span', { text: n.title }));
  const out = [];
  const q = S.treeFilter.trim().toLowerCase();
  if (q) {
    const hits = S.all.filter((n) => n.file.toLowerCase().includes(q)).slice(0, 200);
    hits.forEach((n) => out.push(noteItem(n, 0)));
    if (!hits.length) out.push(h('p', { cls: 'empty', text: 'No notes match.' }));
  } else {
    const walk = (node, depth) => {
      [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })).forEach(([name, f]) => {
        const open = S.treeOpen.has(f.path);
        out.push(h('button', { type: 'button', cls: 'tree-item tree-folder' + (open ? ' open' : ''), style: `padding-left:${8 + depth * 16}px`, 'aria-expanded': String(open),
          onClick: () => { open ? S.treeOpen.delete(f.path) : S.treeOpen.add(f.path); paintTree(); } },
          icon('chevron', 'sm chev'), h('span', { text: name }), h('small', { text: String(f.count) })));
        if (open) walk(f, depth + 1);
      });
      node.notes.forEach((n) => out.push(noteItem(n, depth)));
    };
    walk(buildTree(), 0);
    if (!S.all.length) out.push(h('p', { cls: 'empty', text: 'No notes in this vault yet.' }));
  }
  const top = $('tree-list').scrollTop;
  $('tree-list').replaceChildren(...out);
  $('tree-list').scrollTop = top;
}
function paintReader() {
  const n = S.note;
  if (!n) {
    $('reader').replaceChildren(h('div', { cls: 'reader-empty' }, mark('splash-book-static'), h('h2', { text: 'Pick a note' }),
      h('p', { text: 'Choose a note on the left, or search for one. Notes open here, read-only.' })));
    const m = $('reader').querySelector('svg'); if (m) m.setAttribute('style', 'width:44px;height:44px');
    return;
  }
  const linked = linkedNotes(n.file);
  const rt = relTime(n.mtimeMs);
  const meta = [rt === 'now' ? 'Edited just now' : /min$| h$/.test(rt) ? `Edited ${rt} ago` : `Edited ${rt}`];
  if (linked) meta.push(`${linked.length} linked note${linked.length === 1 ? '' : 's'}`);
  meta.push(`${num(n.content.split(/\s+/).filter(Boolean).length)} words`);
  const body = MD.render(n.content, { ...mdCtx, frontmatter: true, breaks: true });
  const first = body.querySelector(':scope > h1');
  if (first && first.textContent.trim().toLowerCase() === n.title.toLowerCase()) first.remove(); // the header already shows the title
  const top = $('reader').scrollTop;
  $('reader').replaceChildren(h('div', { cls: 'reader-inner' },
    h('header', { cls: 'note-head' },
      h('span', { cls: 'eyebrow mono', text: n.folder || 'Vault' }), h('h1', { text: n.title }), h('span', { cls: 'note-meta', text: meta.join(' · ') }),
      h('div', { cls: 'note-acts' },
        pill('pill pill-accent', 'Ask Rook about this', () => { S.noteCtx = true; paintAsk(); focusAsk(); }, 'chat'),
        pill('pill pill-outline', 'Open in Obsidian', () => VA.openNote(n.file), 'external'),
        pill('pill pill-outline', 'Show on map', () => showOnMap(n.file), 'graph'))),
    body,
    linked && linked.length ? h('section', { cls: 'backlinks' }, h('h2', { text: 'Linked notes' }),
      h('div', { cls: 'rows' }, linked.map((l) => row('link', l.title, l.folder || 'Vault', '', () => openNote(l.id))))) : null));
  $('reader').scrollTop = top;
}

// ---------- MAP (the other face of the Notes page) ----------
function paintPane() {
  $('reader').classList.toggle('hidden', S.pane !== 'note');
  $('map-pane').classList.toggle('hidden', S.pane !== 'map');
  if (S.pane === 'note') paintReader(); else paintMap();
  paintAsk();
}
async function paintMap() {
  const host = $('map-pane');
  if (S.map && !S.graphStale) return;
  const data = await ensureGraph();
  if (S.view !== 'notes' || S.pane !== 'map') return;
  if (S.map) { S.map.destroy(); S.map = null; }
  S.mapSel = null;
  if (!data.nodes.length) { host.replaceChildren(h('div', { cls: 'map-empty' }, h('h2', { text: 'Nothing to map yet' }), h('p', { text: 'Notes appear here as dots; [[links]] between them appear as lines.' }))); return; }
  const canvas = h('canvas', { 'aria-label': 'Map of linked notes', role: 'img' });
  const filter = h('input', { type: 'search', placeholder: 'Highlight notes', 'aria-label': 'Highlight notes on the map', autocomplete: 'off', spellcheck: 'false' });
  const card = h('div');
  host.replaceChildren(canvas,
    h('div', { cls: 'map-top' }, h('label', { cls: 'filter' }, icon('search', 'sm'), filter),
      h('span', { cls: 'map-count', text: `${num(data.nodes.length)} notes · ${num(data.edges.length)} links` })),
    h('div', { cls: 'map-zoom' }, tool('plus', 'Zoom in', () => S.map.zoom(1.3)), tool('minus', 'Zoom out', () => S.map.zoom(1 / 1.3)), tool('fit', 'Fit the whole map', () => S.map.fit())),
    card);
  const paintCard = (sel) => {
    S.mapSel = sel;
    card.replaceChildren(...(sel ? [h('div', { cls: 'map-card' }, h('span', { cls: 'eyebrow mono', text: sel.folder || 'Vault' }), h('h3', { text: sel.title }),
      h('span', { cls: 'note-meta', text: `${sel.links} linked note${sel.links === 1 ? '' : 's'}` }),
      h('div', { cls: 'note-acts' }, pill('pill-ghost', 'Open note', () => openNote(sel.id), 'file'), pill('pill-ghost', 'Obsidian', () => VA.openNote(sel.id), 'external')))] : []));
  };
  S.map = window.RookGraph.create(canvas, data, { onSelect: paintCard, onOpen: (id) => openNote(id) });
  filter.addEventListener('input', () => S.map.setFilter(filter.value));
}
async function showOnMap(file) { S.pane = 'map'; go('notes'); await paintMap(); if (S.map) S.map.select(file); }

// ---------- CHAT LIST (on the Chat home page) ----------
function seg(opts, value, onPick, label) {
  return h('div', { cls: 'segmented', role: 'group', 'aria-label': label }, opts.map(([v, l]) =>
    h('button', { type: 'button', cls: v === value ? 'on' : '', 'aria-pressed': String(v === value), onClick: () => onPick(v) }, l)));
}
function historyNodes() {
  const q = S.chatFilter.toLowerCase();
  let list = S.chats.filter((c) => !q || c.title.toLowerCase().includes(q) || c.msgs.some((m) => (m.text || (m.blocks || []).map((b) => b.text || '').join(' ')).toLowerCase().includes(q)));
  if (S.chatTab === 'pinned') list = list.filter((c) => c.pinned);
  if (S.chatTab === 'week') list = list.filter((c) => chatGroup(c.when) !== 'Earlier');
  list.sort((a, b) => b.when - a.when);
  const filter = h('input', { type: 'search', id: 'hist-filter', placeholder: 'Filter by title or text', 'aria-label': 'Filter saved chats', value: S.chatFilter, autocomplete: 'off' });
  filter.addEventListener('input', () => { S.chatFilter = filter.value; const pos = filter.selectionStart; paintHome(); const f = $('hist-filter'); f.focus(); f.setSelectionRange(pos, pos); });
  const out = [h('div', { cls: 'sec-head' }, h('h2', { text: 'Chats' })),
    h('div', { cls: 'list-tools' }, h('label', { cls: 'filter' }, icon('search', 'sm'), filter),
      seg([['all', 'All'], ['pinned', 'Pinned'], ['week', 'This week']], S.chatTab, (v) => { S.chatTab = v; paintHome(); }, 'Show'),
      h('span', { cls: 'list-note', text: `${S.chats.length} saved · ${S.chats.filter((c) => c.pinned).length} pinned` }))];
  for (const label of ['Today', 'This week', 'Earlier']) {
    const items = list.filter((c) => chatGroup(c.when) === label);
    if (!items.length) continue;
    out.push(h('div', { cls: 'group-label', text: label }), h('div', { cls: 'rows' }, items.map(chatRow)));
  }
  if (!list.length) out.push(h('p', { cls: 'empty', text: S.chats.length ? 'No chats match.' : 'No saved chats yet. Start a conversation and it will appear here.' }));
  return out;
}
function chatRow(c) {
  if (S.renaming === c.id) {
    const inp = h('input', { cls: 'rename', value: c.title, 'aria-label': 'Rename chat' });
    const commit = () => { if (S.renaming !== c.id) return; c.title = inp.value.trim() || c.title; S.renaming = null; persist(); paintHome(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { S.renaming = null; paintHome(); } });
    inp.addEventListener('blur', commit);
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    return h('div', { style: 'padding:9px 12px' }, inp);
  }
  return h('div', { cls: 'row-wrap' },
    row('chat', c.title, chatPreview(c), chatMeta(c.when), () => openChat(c), { pinned: c.pinned }),
    h('div', { cls: 'row-acts' },
      tool('pin', c.pinned ? 'Unpin ' + c.title : 'Pin ' + c.title, () => { c.pinned = !c.pinned; persist(); paintHome(); }, { title: c.pinned ? 'Unpin' : 'Pin', on: c.pinned }),
      tool('pen', 'Rename ' + c.title, () => { S.renaming = c.id; paintHome(); }, { title: 'Rename' }),
      tool('trash', 'Delete ' + c.title, () => {
        const idx = S.chats.indexOf(c); S.chats.splice(idx, 1); if (S.cur === c) S.cur = null; persist(); paintHome();
        toast('Chat deleted.', { action: 'Undo', onAction: () => { S.chats.splice(idx, 0, c); persist(); paint(); } });
      }, { title: 'Delete' })));
}

// ---------- SETTINGS ----------
async function paintSettings() {
  const cfg = S.cfg;
  const save = async (patch, msg) => { S.cfg = await VA.setConfig({ ...S.cfg, ...patch }); if (msg !== null) toast(msg || 'Saved.'); paintAsk(); }; // msg null: the change is visible, no toast
  const vault = h('input', { cls: 'sp-input mono', id: 'st-vault', value: cfg.vaultWin, 'aria-label': 'Vault folder', spellcheck: 'false' });
  const help = h('p', { cls: 'sp-help' });
  const check = async (commit) => {
    const r = await VA.vaultInfo(vault.value);
    help.className = 'sp-help' + (r.ok ? '' : ' warn');
    help.textContent = r.ok ? `Obsidian vault found · ${num(r.notes)} notes in ${num(r.folders)} folders.` : r.reason;
    if (r.ok && commit && vault.value !== S.cfg.vaultWin) { await save({ vaultWin: vault.value }, 'Vault changed.'); S.note = null; S.graphStale = true; S.treeOpen.clear(); await loadNotes(); }
  };
  vault.addEventListener('change', () => check(true));
  check(false);
  const claude = h('input', { cls: 'sp-input mono', value: cfg.claudePath, 'aria-label': 'Claude CLI path', spellcheck: 'false' });
  claude.addEventListener('change', () => claude.value.trim() && save({ claudePath: claude.value }));
  const name = h('input', { cls: 'sp-input', value: cfg.name, 'aria-label': 'Your name' });
  name.addEventListener('change', () => name.value.trim() && save({ name: name.value }));
  const scopeHost = h('div'), scopeHelp = h('p', { cls: 'sp-help' });
  const paintScope = () => {
    scopeHost.replaceChildren(seg([['machine', 'Whole machine'], ['vault', 'Vault only']], S.cfg.readScope, async (v) => { await save({ readScope: v }); paintScope(); }, 'Reading scope'));
    scopeHelp.textContent = S.cfg.readScope === 'machine' ? 'Rook can read files anywhere on this PC to answer questions.' : 'Rook can read only inside your vault.';
  };
  paintScope();
  const card = (id, title, ...kids) => h('section', { cls: 'settings-card', id }, h('h2', { text: title }), ...kids);
  const startHost = h('div');
  const paintStart = () => startHost.replaceChildren(seg([['on', 'On'], ['off', 'Off']], S.cfg.launchAtLogin === false ? 'off' : 'on',
    async (v) => { await save({ launchAtLogin: v === 'on' }); paintStart(); }, 'Open Rook when Windows starts'));
  paintStart();
  // Appearance
  const lookHost = h('div', { cls: 'sp-stack' });
  const paintLook = () => lookHost.replaceChildren(
    h('div', { cls: 'sp-line' }, h('span', { text: 'Theme' }), seg([['dark', 'Dark'], ['light', 'Light'], ['system', 'Match Windows']], S.cfg.theme || 'dark', async (v) => { await save({ theme: v }, null); applyTheme(); paintLook(); }, 'Theme')),
    h('div', { cls: 'sp-line' }, h('span', { text: 'Text size' }), seg([['small', 'Small'], ['regular', 'Regular'], ['large', 'Large']], S.cfg.textSize || 'regular', async (v) => { await save({ textSize: v }, null); applyTheme(); paintLook(); }, 'Text size')));
  paintLook();

  // Projects: folders Rook knows by name
  const projHost = h('div', { cls: 'sp-stack' });
  const paintProjects = () => {
    const list = S.cfg.projects || [];
    const pName = h('input', { cls: 'sp-input', placeholder: 'Name, e.g. rook', 'aria-label': 'Project name' });
    const pPath = h('input', { cls: 'sp-input mono', placeholder: 'Folder, e.g. /home/you/project or C:\\Users\\you\\project', 'aria-label': 'Project folder', spellcheck: 'false' });
    const add = async () => {
      if (!pName.value.trim() || !pPath.value.trim()) return toast('Give the project a name and a folder.', { error: true });
      const before = list.length;
      await save({ projects: [...list, { name: pName.value, path: pPath.value }] }, 'Project added.');
      if ((S.cfg.projects || []).length === before) toast('That folder path was not understood. Use a full path.', { error: true });
      paintProjects();
    };
    [pName, pPath].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); }));
    projHost.replaceChildren(
      list.length ? h('dl', { cls: 'keys' }, list.map((p, i) => h('div', null, h('dt', null, p.name, h('span', { cls: 'proj-path mono', text: p.path })),
        h('dd', null, tool('trash', `Remove ${p.name}`, async () => { await save({ projects: list.filter((_, k) => k !== i) }, 'Project removed.'); paintProjects(); }, { title: 'Remove' })))))
        : h('p', { cls: 'sp-help', text: 'No projects yet. Add one and Rook will know where it lives when you mention it by name.' }),
      h('div', { cls: 'sp-row proj-add' }, pName, pPath,
        pill('pill-ghost', 'Browse', async () => { const p = await VA.pickFolder(); if (p) { pPath.value = p; if (!pName.value) pName.value = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop(); } }),
        pill('pill-ghost', 'Add', add)));
  };
  paintProjects();

  // Scheduled notes
  const schedHost = h('div', { cls: 'sp-stack' });
  const paintSched = () => {
    const sc = { dailyDays: [], weeklyDay: -1, weeklyHour: 16, ...(S.cfg.schedule || {}) };
    const setSched = async (patch) => { await save({ schedule: { ...sc, ...patch } }, null); paintSched(); };
    const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
    const dayBtns = h('div', { cls: 'day-picks', role: 'group', 'aria-label': 'Days that get a daily note' }, order.map((d) =>
      h('button', { type: 'button', cls: sc.dailyDays.includes(d) ? 'on' : '', 'aria-pressed': String(sc.dailyDays.includes(d)),
        onClick: () => setSched({ dailyDays: sc.dailyDays.includes(d) ? sc.dailyDays.filter((x) => x !== d) : [...sc.dailyDays, d] }) }, DAYS[d])));
    const daySel = h('select', { cls: 'sp-select', 'aria-label': 'Day of the weekly review' }, [[-1, 'Off'], ...order.map((d) => [d, DAYS[d]])].map(([v, l]) => h('option', { value: String(v), selected: v === sc.weeklyDay }, l)));
    daySel.addEventListener('change', () => setSched({ weeklyDay: Number(daySel.value) }));
    const hourSel = h('select', { cls: 'sp-select', 'aria-label': 'Hour of the weekly review', disabled: sc.weeklyDay < 0 }, Array.from({ length: 24 }, (_, hr) => h('option', { value: String(hr), selected: hr === sc.weeklyHour }, `${pad(hr)}:00`)));
    hourSel.addEventListener('change', () => setSched({ weeklyHour: Number(hourSel.value) }));
    const runNow = pill('pill-ghost', 'Write this week’s review now', async () => {
      runNow.disabled = true; toast('Writing the weekly review in the background…');
      try { await VA.runWeekly(); } finally { runNow.disabled = false; }
    });
    schedHost.replaceChildren(
      h('div', { cls: 'sp-line' }, h('span', { text: 'Daily note on' }), dayBtns),
      h('p', { cls: 'sp-help', text: sc.dailyDays.length ? 'On these days Rook creates the day’s note in Daily/ (from Templates/daily.md if there is one).' : 'No days picked, so no daily notes are created.' }),
      h('div', { cls: 'sp-line' }, h('span', { text: 'Weekly review' }), h('div', { cls: 'sp-row' }, daySel, hourSel)),
      h('p', { cls: 'sp-help', text: sc.weeklyDay < 0 ? 'Off.' : 'Rook reads the week’s notes and writes a review into the vault. If the PC is off at that time, it is written the next time Rook is running that week.' }),
      h('div', { cls: 'sp-line' }, h('span', { cls: 'sp-help', text: 'Scheduled notes need Rook running; it can sit in the tray.' }), runNow));
  };
  paintSched();

  // Voice
  const voiceHost = h('div', { cls: 'sp-stack' });
  const paintVoice = async () => {
    VOICE.status = await VA.voice.status().catch(() => VOICE.status);
    const st = VOICE.status;
    voiceHost.replaceChildren(
      h('div', { cls: 'sp-line' }, h('span', { id: 'voice-line', text: st.installing ? `Downloading… ${st.percent}%` : st.installed ? 'Hold to talk is installed.' : 'Hold to talk is not installed.' }),
        st.installing ? null : st.installed
          ? pill('pill-ghost', 'Remove', async () => { await VA.voice.remove(); paintVoice(); paintMic(); toast('Voice removed.'); })
          : pill('pill-ghost', `Download (about ${st.sizeMb} MB)`, async () => { VOICE.status = { ...st, installing: true, percent: 0 }; paintVoice(); const r = await VA.voice.install(); if (!r.ok) toast(`Voice could not be set up: ${r.error}`, { error: true }); await paintVoice(); paintMic(); })),
      h('p', { cls: 'sp-help', text: `Hold the microphone button in the ask box, or hold ${keyHint('voice')}, and speak; let go and the words are typed for you. Speech is turned into text on this PC (English) and is never sent anywhere. Without it, the microphone button offers Windows voice typing instead.` }));
  };
  paintVoice();

  const keysHost = h('div');
  const setKeys = async (keys, msg) => {
    await save({ keys }, msg || 'Shortcut changed.'); paintTools(); paintKeys();
    for (const [flag, action, what] of [['summonOk', 'summon', 'showing Rook'], ['captureOk', 'capture', 'capturing text']])
      if (S.cfg[flag] === false) toast(`Windows would not give Rook ${keyHint(action)}: another app is using it. Pick a different shortcut for ${what}.`, { error: true });
  };
  const paintKeys = () => keysHost.replaceChildren(shortcutRows(setKeys));
  paintKeys();
  const secs = [['set-vault', 'Vault'], ['set-access', 'Access'], ['set-assistant', 'Assistant'], ['set-projects', 'Projects'], ['set-schedule', 'Scheduled notes'], ['set-voice', 'Voice'], ['set-look', 'Appearance'], ['set-startup', 'Startup'], ['set-keys', 'Keyboard shortcuts'], ['set-about', 'About']];
  const nav = h('nav', { cls: 'settings-nav', 'aria-label': 'Settings categories' }, secs.map(([id, l], i) =>
    h('button', { type: 'button', cls: i ? '' : 'on', onClick: (e) => { nav.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); $(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, l)));
  $('view-settings').replaceChildren(
    h('button', { type: 'button', cls: 'back-link', onClick: () => go(S.prevView === 'settings' ? 'home' : S.prevView) }, icon('back'), 'Back'),
    h('h1', { cls: 'page-title', text: 'Settings' }),
    h('div', { cls: 'settings-layout' }, nav, h('div', { cls: 'settings-body' },
      card('set-vault', 'Vault',
        h('div', { cls: 'sp-field' }, h('span', { cls: 'sp-label' }, h('span', { text: 'Vault folder' })),
          h('div', { cls: 'sp-row' }, vault, pill('pill-ghost', 'Browse', async () => { const p = await VA.pickFolder(); if (p) { vault.value = p; check(true); } })), help)),
      card('set-access', 'Access',
        h('div', { cls: 'sp-line' }, h('span', { text: 'Can read' }), scopeHost), scopeHelp,
        h('div', { cls: 'sp-line' }, h('span', { text: 'Can write' }), h('span', { cls: 'sp-fixed' }, icon('lock', 'sm'), 'Vault only')),
        h('p', { cls: 'sp-help', text: 'This is fixed. Files elsewhere are read-only; a request to change one is written as a new note inside the vault.' })),
      card('set-assistant', 'Assistant',
        h('div', { cls: 'sp-field' }, h('span', { cls: 'sp-label' }, h('span', { text: 'Claude CLI path, inside WSL' })), claude),
        h('p', { cls: 'sp-help', text: 'Rook runs Claude Code in WSL. Sign in once with “claude auth login” (or make login).' }),
        h('div', { cls: 'sp-field' }, h('span', { cls: 'sp-label' }, h('span', { text: 'Your name' })), name)),
      card('set-projects', 'Projects', projHost),
      card('set-schedule', 'Scheduled notes', schedHost),
      card('set-voice', 'Voice', voiceHost),
      card('set-look', 'Appearance', lookHost),
      card('set-startup', 'Startup',
        h('div', { cls: 'sp-line' }, h('span', { text: 'Open Rook when Windows starts' }), startHost),
        h('p', { cls: 'sp-help', text: 'It starts quietly in the tray by the clock; click its icon to open the window.' })),
      card('set-keys', 'Keyboard shortcuts', keysHost,
        h('div', { cls: 'sp-line' }, h('span', { cls: 'sp-help', text: 'Click a shortcut, then press the new keys (Ctrl, Alt, Shift and the Windows key all work). Esc cancels. Windows keeps some Windows-key combinations for itself.' }),
          pill('pill-ghost', 'Reset to defaults', () => setKeys({}, 'Shortcuts reset.')))),
      card('set-about', 'About', h('div', { cls: 'sp-line' }, h('span', { text: 'Rook' }), h('span', { cls: 'mono muted', text: S.version ? 'v' + S.version : '' })),
        h('div', { cls: 'sp-line', id: 'upd-slot' }),
        h('p', { cls: 'sp-help', text: 'Your notes stay in the vault on this computer. Saved chats and settings are kept locally in Rook’s app data.' })))));
  paintUpdate();
}

// ---------- updates ----------
// An update shows as a button in the top bar. Clicking it downloads in the background; Rook restarts
// into the new version once the download is done (and any reply in progress has finished).
function updateText(u) {
  switch (u.state) {
    case 'checking': return 'Checking for updates…';
    case 'current': return 'Rook is up to date.';
    case 'available': return `Version ${u.version} is available.`;
    case 'downloading': return `Updating to version ${u.version || ''}… ${u.percent || 0}%. Rook restarts when it is done.`;
    case 'ready': return `Version ${u.version} is ready. Restarting…`;
    case 'error': return 'Could not check for updates.';
    case 'dev': return 'Updates are off in the development build.';
    default: return 'Rook checks for updates on its own.';
  }
}
function updateButton(cls) {
  const u = S.update;
  if (u.state === 'available') return h('button', { type: 'button', cls, title: `Update to version ${u.version}. Rook restarts when the download is done.`, onClick: () => VA.update.download() }, h('span', { cls: 'upd-dot', 'aria-hidden': 'true' }), 'Update available');
  if (u.state === 'downloading') return h('button', { type: 'button', cls, disabled: true, title: 'Downloading in the background' }, h('span', { cls: 'spinner', 'aria-hidden': 'true' }), `Updating… ${u.percent || 0}%`);
  if (u.state === 'ready') return h('button', { type: 'button', cls, title: 'Restart into the new version', onClick: () => VA.update.install() }, h('span', { cls: 'upd-dot', 'aria-hidden': 'true' }), 'Restart to update');
  return null;
}
function paintUpdate() {
  const u = S.update;
  $('upd-pill').replaceChildren(...[updateButton('upd-pill')].filter(Boolean));
  const slot = $('upd-slot'); // Settings › About, when that page is showing
  if (!slot) return;
  document.querySelectorAll('.upd-err').forEach((e) => e.remove());
  slot.replaceChildren(h('span', { cls: 'muted', role: 'status', text: updateText(u) }),
    updateButton('pill-ghost') || h('button', { type: 'button', cls: 'pill-ghost', disabled: u.state === 'checking', onClick: () => VA.update.check() }, 'Check for updates'));
  if (u.state === 'error' && u.error) slot.after(h('p', { cls: 'sp-help warn upd-err', text: u.error }));
}
function installWhenIdle() { if (S.update.state === 'ready' && !S.streaming) VA.update.install(); }
function onUpdate(u) {
  S.update = u;
  paintUpdate();
  installWhenIdle();
}

// ---------- ask bar + compact strip ----------
function autogrow() { const t = $('ask'); t.style.height = 'auto'; t.style.height = Math.min(180, t.scrollHeight) + 'px'; }
function focusAsk() { (S.mini === 'bar' ? $('compact-input') : $('ask')).focus(); }
function sendBtn(value, onSend) {
  return S.streaming
    ? h('button', { type: 'button', cls: 'send', 'aria-label': 'Stop generating', title: 'Stop (Esc)', onClick: stop }, h('span', { cls: 'stop-sq', 'aria-hidden': 'true' }))
    : h('button', { type: 'button', cls: 'send', 'aria-label': 'Send', title: 'Send (Enter)', disabled: !value.trim(), onClick: onSend }, icon('up', 'sm'));
}
function paintAsk() {
  $('askbar').classList.toggle('hidden', S.view === 'settings');
  $('askbar').classList.toggle('busy', S.streaming);
  $('send-slot').replaceChildren(sendBtn($('ask').value || (ATTACH.length ? '.' : ''), () => send($('ask').value)));
  $('ask-files').replaceChildren(...attachNodes());
  const ctx = S.view === 'notes' && S.pane === 'note' && S.note && S.noteCtx;
  $('ask-ctx-slot').replaceChildren(...(ctx ? [h('span', { cls: 'ask-ctx' }, icon('file', 'sm'), h('span', { text: `About: ${S.note.title}` }),
    h('button', { type: 'button', 'aria-label': 'Ask without this note', title: 'Ask without this note', onClick: () => { S.noteCtx = false; paintAsk(); } }, icon('x', 'sm')))] : []));
  const agent = agentLabel();
  $('ask-hint').replaceChildren(S.cfg.readScope === 'vault' ? 'Reads only inside your vault · writes only inside your vault' : 'Reads anywhere on this PC · writes only inside your vault',
    ' · ', h('button', { type: 'button', cls: 'hint-btn', title: 'Choose the model and effort (or type /agent)', onClick: () => (popKind === 'agent' ? closePop() : openAgentPop()) }, agent || '/agent'));
  // compact strip
  const bot = lastBot();
  $('compact').classList.toggle('busy', S.streaming);
  $('compact-status').textContent = S.streaming ? (bot?.blocks.some((b) => b.t === 'tool' && b.status === 'running') ? 'Working' : 'Writing') : bot?.error ? 'Failed' : bot?.done && S.mini ? 'Done' : 'Quick capture';
  $('compact-send').replaceChildren(sendBtn($('compact-input').value, () => send($('compact-input').value)));
}
// Mini modes: 'panel' is a side chat that shows the conversation; 'bar' is the quick-capture strip. false is the full window.
function lastMini() { try { return localStorage.getItem('rook.mini') === 'bar' ? 'bar' : 'panel'; } catch { return 'panel'; } }
function setMini(mode) {
  mode = mode === 'bar' || mode === 'panel' ? mode : false;
  if (mode === S.mini) return;
  S.mini = mode;
  if (mode) { try { localStorage.setItem('rook.mini', mode); } catch { /* not remembered */ } }
  document.body.dataset.mini = mode || '';
  $('ask').placeholder = mode === 'panel' ? 'Ask Rook…' : 'Ask about your vault, or tell Rook what to write…';
  VA.win.mini(mode);
  if (mode && S.view !== 'home') go('home'); else paint();
  requestAnimationFrame(() => { $('scroller').scrollTop = $('scroller').scrollHeight; });
  setTimeout(focusAsk, 60);
}
function toggleMini() { setMini(S.mini ? false : lastMini()); }

// ---------- navigation ----------
const NAV = [['home', 'Chat'], ['notes', 'Notes']];
function go(view) {
  if (view !== S.view && S.view !== 'settings') S.prevView = S.view;
  S.view = view;
  if (S.mini && view !== 'home') { setMini(false); return; } // notes and settings need the full window
  paint();
}
function paint() {
  const el = S.view === 'home' ? (S.cur && S.cur.msgs.length ? 'view-chat' : 'view-home') : 'view-' + S.view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === el));
  $('topnav').replaceChildren(...NAV.map(([v, l]) => h('button', { type: 'button', cls: S.view === v ? 'on' : '', 'aria-current': S.view === v ? 'page' : null, onClick: () => go(v) }, l)));
  if (el === 'view-home') paintHome();
  else if (el === 'view-chat') paintChat();
  else if (S.view === 'notes') { paintTree(); paintPane(); }
  else if (S.view === 'settings') paintSettings();
  paintAsk();
}
async function loadNotes() {
  try {
    const [recent, all, info] = await Promise.all([VA.recentNotes(), VA.listNotes(), VA.vaultInfo()]);
    S.recent = recent; S.all = all; S.names = new Set(all.map((n) => baseName(n.file)));
    if (info.ok) S.noteCount = info.notes;
    const sig = all.length + ':' + all.reduce((a, n) => a + n.mtimeMs, 0);
    if (sig !== S.noteSig) { S.noteSig = sig; S.graphStale = true; }
  } catch { /* the vault may be unavailable; keep what we have */ }
  if (S.view === 'home' && !(S.cur && S.cur.msgs.length)) { if (!$('view-home').contains(document.activeElement)) paintHome(); }
  else if (S.view === 'notes') paintTree();
}

// ---------- keyboard shortcuts (changeable in Settings) ----------
const SHORTCUTS = [
  ['newChat', 'New conversation', 'Ctrl+N', () => newChat()],
  ['mini', 'Side chat or bar', 'Ctrl+M', () => toggleMini()],
  ['settings', 'Settings', 'Ctrl+,', () => go('settings')],
  ['chat', 'Go to Chat', 'Ctrl+1', () => go('home')],
  ['notes', 'Go to Notes', 'Ctrl+2', () => go('notes')],
  ['search', 'Search notes and chats', 'Ctrl+K', () => openPalette()],
  ['voice', 'Hold to talk', 'Alt+V', () => voiceHoldKey()],
  ['summon', 'Show or hide Rook, from any app', 'Ctrl+Alt+Space', () => {}], // these two are registered system-wide by the main process
  ['capture', 'Send highlighted text to today’s note, from any app', 'Ctrl+Alt+C', () => {}]
];
// Holding the voice shortcut records until its last key is let go.
let voiceKeyDown = false;
function voiceHoldKey() { if (voiceKeyDown) return; voiceKeyDown = true; voiceStart(); }
const keyOf = (action) => (S.cfg?.keys || {})[action] || SHORTCUTS.find((x) => x[0] === action)[2];
const keyHint = (action) => keyOf(action).split('+').join(' ');
// The combination a key press stands for, e.g. "Ctrl+Shift+K"; null while only modifier keys are down.
function comboOf(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win', key].filter(Boolean).join('+');
}
let recording = null; // the shortcut being changed in Settings, if any
function shortcutRows(onChange) {
  const rows = SHORTCUTS.map(([action, label]) => {
    const btn = h('button', { type: 'button', cls: 'key-btn', 'aria-label': `Change the shortcut for ${label}`, title: 'Click, then press the new keys' });
    const show = () => { btn.classList.remove('rec'); btn.replaceChildren(...keyOf(action).split('+').map((k) => h('kbd', { text: k }))); };
    btn.addEventListener('click', () => {
      if (recording) recording.cancel();
      btn.classList.add('rec'); btn.replaceChildren('Press keys…');
      recording = { cancel: () => { recording = null; show(); }, take: (combo) => {
        if (!/(^|\+)(Ctrl|Alt|Win)\+/.test(combo) && !/^(Shift\+)?F\d{1,2}$/.test(combo)) return toast('Use Ctrl, Alt or the Windows key with another key, or a function key.', { error: true });
        const clash = SHORTCUTS.find(([a]) => a !== action && keyOf(a) === combo);
        if (clash) return toast(`${combo.split('+').join(' ')} is already used by “${clash[1]}”.`, { error: true });
        recording = null;
        onChange({ ...(S.cfg.keys || {}), [action]: combo });
      } };
    });
    btn.addEventListener('blur', () => { if (recording && btn.classList.contains('rec')) recording.cancel(); });
    show();
    return h('div', null, h('dt', { text: label }), h('dd', null, btn));
  });
  const fixed = [['Send', ['Enter']], ['New line', ['Shift', 'Enter']], ['Stop a reply', ['Esc']]].map(([l, ks]) =>
    h('div', null, h('dt', { text: l }), h('dd', null, ks.map((k) => h('kbd', { text: k })))));
  return h('dl', { cls: 'keys' }, rows, fixed);
}

// ---------- wiring ----------
function paintTools() {
  $('topbar-tools').replaceChildren(h('span', { id: 'upd-pill' }), tool('plus', 'New conversation', newChat, { title: `New conversation (${keyHint('newChat')})` }),
    tool('search', 'Search', openPalette, { title: `Search notes and chats (${keyHint('search')})` }),
    tool('chat', 'Side chat', () => setMini('panel'), { title: 'Side chat' }),
    tool('compact', 'Quick-capture bar', () => setMini('bar'), { title: 'Quick-capture bar' }),
    tool('settings', 'Settings', () => go('settings'), { title: `Settings (${keyHint('settings')})` }));
  $('compact-expand').replaceChildren(tool('chat', 'Side chat', () => setMini('panel'), { title: 'Show the chat' }),
    tool('expand', 'Return to window', () => setMini(false), { title: `Return to window (${keyHint('mini')})` }));
  $('panel-tools').replaceChildren(tool('clock', 'Saved chats', () => { if (S.streaming) return toast('Wait for the reply to finish, or stop it first.'); S.plist = !(S.plist && !S.cur); S.cur = null; go('home'); }, { title: 'Saved chats' }),
    tool('plus', 'New conversation', newChat, { title: `New conversation (${keyHint('newChat')})` }),
    tool('compact', 'Quick-capture bar', () => setMini('bar'), { title: 'Shrink to a bar' }),
    tool('expand', 'Return to window', () => setMini(false), { title: `Return to window (${keyHint('mini')})` }));
  paintUpdate();
}
function wire() {
  $('brand-mark').append(mark());
  $('compact-mark').append(mark('compact-mark'));
  $('go-home').addEventListener('click', () => go('home'));
  $('panel-mark').append(mark());
  $('attach-slot').append(tool('clip', 'Attach files', () => $('file-pick').click(), { title: 'Attach files or screenshots (or drop or paste them here)' }));
  const mic = tool('mic', 'Hold to talk', () => {}, { title: 'Hold to talk' });
  mic.addEventListener('pointerdown', (e) => { if (e.button === 0) { mic.setPointerCapture(e.pointerId); voiceStart(); } });
  for (const ev of ['pointerup', 'pointercancel']) mic.addEventListener(ev, () => voiceStop());
  mic.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) voiceStart(); });
  mic.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') voiceStop(); });
  $('mic-slot').append(mic);
  document.addEventListener('keyup', () => { if (voiceKeyDown) { voiceKeyDown = false; voiceStop(); } }, true);
  window.addEventListener('blur', () => { if (voiceKeyDown) { voiceKeyDown = false; voiceStop(); } });
  $('file-pick').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  // Files dropped anywhere on the window, or pasted into the ask box, become attachments.
  document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
  $('ask').addEventListener('paste', (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } });
  document.addEventListener('mousedown', (e) => { if (popKind && !e.target.closest('#ask-pop, .hint-btn, #ask, #mic-slot')) closePop(); });
  $('win-min').addEventListener('click', () => VA.win.minimize());
  $('win-max').addEventListener('click', () => VA.win.maximize());
  $('win-close').addEventListener('click', () => VA.win.close());

  const ask = $('ask');
  ask.addEventListener('input', () => { autogrow(); paintAsk(); updateSlash(ask.value); });
  ask.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!trySlash(ask.value)) send(ask.value); } });
  const ci = $('compact-input');
  ci.addEventListener('input', paintAsk);
  ci.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(ci.value); } });

  document.addEventListener('keydown', (e) => {
    if (recording) { // Settings is waiting for a new shortcut: this key press is the answer, not a command
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return recording.cancel();
      const combo = comboOf(e);
      if (combo) recording.take(combo);
      return;
    }
    if (overlayKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const combo = comboOf(e);
    const hit = combo && SHORTCUTS.find(([a]) => keyOf(a) === combo);
    if (hit) { e.preventDefault(); if (!e.repeat || hit[0] !== 'voice') hit[3](); }
    else if (e.key === 'Escape' && S.streaming) stop();
  }, true);
}

(async function boot() {
  const started = Date.now();
  wire();
  S.cfg = await VA.getConfig();
  S.version = await VA.version().catch(() => '');
  S.update = await VA.update.get().catch(() => S.update);
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  paintTools();
  VA.update.onStatus(onUpdate);
  VA.onSummon(() => setTimeout(focusAsk, 60));
  VA.voice.onProgress(onVoiceProgress);
  VOICE.status = await VA.voice.status().catch(() => VOICE.status);
  paintMic();
  VA.onSchedule((ev) => { toast(`${ev.title}${ev.body ? ': ' + ev.body : ''}`); loadNotes(); });
  S.chats = (await VA.loadChats()) || [];
  for (const c of S.chats) for (const m of c.msgs) if (m.role === 'bot' && !m.done) { m.done = true; m.stopped = true; }
  await loadNotes();
  paint();
  // The splash stays long enough for the book to draw and one line to be written, then turns away like a page.
  setTimeout(() => {
    const sp = $('splash'); sp.classList.add('done');
    setTimeout(() => sp.remove(), 1000);
    focusAsk();
  }, Math.max(0, 1900 - (Date.now() - started)));
  setInterval(() => { if (!S.streaming) loadNotes(); }, 30000);
})();
