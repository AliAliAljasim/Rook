'use strict';
/* Rook renderer: plain JS, no framework. Builds DOM nodes (never injects untrusted HTML). */
const VA = window.api;
const icon = window.VAIcon;

// ---------- tiny DOM helper ----------
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
const btn = (cls, props, ...kids) => h('button', { type: 'button', cls: 'va-btn ' + cls, ...props }, ...kids);
const iconBtn = (name, label, onClick, extra) => btn('va-btn--icon', { 'aria-label': label, title: extra?.title || label, onClick, ...(extra?.attrs || {}) }, icon(name));

// ---------- state ----------
const S = {
  cfg: null, notes: [], noteCount: 0, chats: [], cur: null, view: 'chat', streaming: false,
  mini: false, draft: '', chatFilter: '', chatTab: 'all', renaming: null, pal: null, toast: null
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
function relTime(ms) {
  const d = new Date(ms), now = new Date(), diff = now - d;
  if (diff < 60000) return 'now';
  if (diff < 86400000 && sameDay(d, now)) return `${Math.max(1, Math.round(diff / 3600000))} h`;
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
const mastDate = () => {
  const d = new Date();
  return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]} · ${d.getDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} ${d.getFullYear()}`;
};

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

// ---------- persistence ----------
let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => VA.saveChats(S.chats.slice(0, 200)), 400);
}

// ---------- markdown context ----------
const mdCtx = { openNote: (n) => VA.openNote(n), openUrl: (u) => VA.openExternal(u), copy: (t) => VA.copy(t) };

// ---------- toast ----------
let toastTimer;
function toast(text, opts = {}) {
  S.toast = { text, ...opts };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; paintToast(); }, 4000);
  paintToast();
}
function paintToast() {
  const host = R.win; if (!host) return;
  host.querySelector('.pr-toast')?.remove();
  if (!S.toast) return;
  const t = S.toast;
  const close = () => { S.toast = null; paintToast(); };
  host.append(h('div', { cls: 'pr-toast' },
    h('div', { cls: 'va-toast' + (t.error ? ' is-error' : ''), 'data-theme': S.view === 'chat' ? 'paper' : 'colophon', 'data-anim': '', role: t.error ? 'alert' : 'status' },
      icon(t.error ? 'alert' : 'check'),
      h('span', { cls: 'va-toast__msg', text: t.text }),
      t.action
        ? btn('va-btn--ghost', { onClick: () => { close(); t.onAction(); } }, t.action)
        : iconBtn('x', 'Dismiss', close))));
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
    case 'Bash': return { verb: 'Ran', rest: ' ' + String(input.command || '').slice(0, 80), lines: [] };
    default: return { verb: name, rest: '', lines: [] };
  }
}
const countLines = (s) => (s ? String(s).split('\n').length : 0);
function chipFor(tool) {
  const input = tool.input || {};
  const win = wslToWin(input.file_path || '');
  const rel = vaultRel(win);
  if (!rel) return null;
  let verb, diff;
  if (tool.name === 'Write') { verb = tool.existed ? 'Edited' : 'Created'; diff = tool.existed ? `${countLines(input.content)} lines` : 'new'; }
  else { verb = 'Edited'; diff = `+${countLines(input.new_string)} −${countLines(input.old_string)}`; }
  return { verb, path: rel, diff };
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
      bot.blocks.push({ t: 'tool', id: c.id, name: c.name, input: c.input, existed: c.existed, status: 'running', ...describeTool(c.name, c.input) });
    }
  } else if (ev.type === 'user') {
    for (const c of ev.message?.content || []) {
      if (c.type !== 'tool_result') continue;
      const tool = bot.blocks.find((b) => b.t === 'tool' && b.id === c.tool_use_id);
      if (!tool) continue;
      const out = typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join(' ');
      if (c.is_error) {
        tool.status = 'failed';
        if (/permission|haven't been granted|not allowed|denied|was blocked/i.test(out)) {
          const p = tool.input?.file_path || tool.input?.path || '';
          tool.err = 'Blocked by read-only rules';
          bot.blocks.push({ t: 'blocked', path: p ? (p.startsWith('/') ? wslToWin(p) : p) : '', verbName: tool.verb });
        } else tool.err = out.slice(0, 200);
      } else {
        tool.status = 'done';
        if (tool.name === 'Edit' || tool.name === 'Write' || tool.name === 'MultiEdit') {
          const chip = chipFor(tool);
          if (chip) {
            let g = lastBlock(bot);
            if (!g || g.t !== 'chips') { g = { t: 'chips', items: [] }; bot.blocks.push(g); }
            g.items.push(chip);
            walkNotes();
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
    persist();
    walkNotes();
    paintComposer();
  }
  scheduleConvo();
}
VA.onEvent(onEvent);

// ---------- sending ----------
function send(text) {
  text = String(text || '').trim();
  if (!text || S.streaming) return;
  if (!S.cur) {
    S.cur = { id: 'c' + Date.now(), title: text.length > 44 ? text.slice(0, 43) + '…' : text, when: Date.now(), pinned: false, sessionId: null, msgs: [] };
    S.chats.unshift(S.cur);
  }
  S.view = 'chat';
  S.cur.msgs.push({ role: 'user', text, time: clock() }, { role: 'bot', time: clock(), blocks: [], done: false });
  S.streaming = true; S.draft = '';
  VA.send(text, S.cur.sessionId);
  persist(); paintAll();
}
function stop() {
  if (!S.streaming) return;
  const bot = lastBot();
  if (bot) bot.stopped = true;
  VA.cancel();
  scheduleConvo();
}
function retry() {
  const msgs = S.cur?.msgs;
  if (!msgs || S.streaming || msgs.length < 2) return;
  msgs.pop();                       // the failed reply
  const user = msgs.pop();          // resend the question that produced it
  send(user.text);
}
function newChat() {
  if (S.streaming) stop();
  S.cur = null; S.view = 'chat'; S.draft = '';
  paintAll(); focusComposer();
}
function openChat(c) {
  if (S.streaming) stop();
  S.cur = c; S.view = 'chat'; paintAll();
}

// ---------- conversation rendering ----------
let convoQueued = false;
function scheduleConvo() { if (convoQueued) return; convoQueued = true; requestAnimationFrame(() => { convoQueued = false; paintConvo(); }); }

function toolEl(b) {
  const run = b.status === 'running';
  const d = h('details', { cls: 'va-tool' + (run ? ' is-running' : '') + (b.status === 'failed' ? ' is-error' : '') });
  if (b.open) d.open = true;
  d.addEventListener('toggle', () => { b.open = d.open; });
  const ic = { Read: 'file', Grep: 'search', Glob: 'search', Edit: 'pen', MultiEdit: 'pen', Write: 'pen' }[b.name] || 'chevron';
  d.append(h('summary', null,
    run ? h('span', { cls: 'va-spinner', 'aria-hidden': 'true' }) : icon(b.status === 'failed' ? 'alert' : ic),
    h('span', { cls: 'va-tool__label' }, h('b', { text: b.verb }), b.rest),
    h('span', { cls: 'va-kicker va-tool__status', text: run ? 'Running' : b.status === 'failed' ? 'Failed' : 'Done' }),
    icon('chevron', 'va-tool__chev')));
  const rows = b.lines.slice();
  if (b.err) rows.push({ a: b.err, b: '' });
  d.append(h('div', { cls: 'va-tool__body' }, h('ol', null, rows.map((l) => h('li', null, h('span', { text: l.a }), h('span', { text: l.b }))))));
  return d;
}
function chipsEl(g) {
  return h('div', { cls: 'va-chips' }, g.items.map((c) =>
    h('button', { type: 'button', cls: 'va-chip', 'aria-label': `${c.verb} ${c.path}, open in Obsidian`, onClick: () => VA.openNote(c.path) },
      icon('pen', 'va-icon--sm'), h('span', { cls: 'va-chip__verb', text: c.verb }), h('span', { cls: 'va-chip__path', text: c.path }),
      h('span', { cls: 'va-chip__diff', text: c.diff }), icon('external', 'va-icon--sm'))));
}
function blockedEl(b) {
  return h('div', { cls: 'va-blocked', role: 'note' }, icon('lock'),
    h('div', { cls: 'va-blocked__body' },
      h('span', { cls: 'va-kicker', text: 'Read-only · outside the vault' }),
      h('p', { cls: 'va-blocked__text', text: 'I can read this file but can’t change it. I’ll write the result to a new note in your vault instead.' }),
      b.path ? h('span', { cls: 'va-blocked__path', text: b.path }) : null,
      S.streaming ? null : btn('va-btn--ghost pr-blocked-btn', { onClick: () => send('Write that to a new note inside the vault instead.') }, 'Write to vault instead')));
}
function botEl(m, isLast) {
  const writing = !m.done && !m.stopped;
  const running = m.blocks.some((b) => b.t === 'tool' && b.status === 'running');
  const art = h('article', { cls: 'pr-bot', 'aria-label': 'Rook replied', 'aria-live': writing ? 'polite' : 'off' });
  if (writing) art.append(h('span', { cls: 'va-streaming va-kicker va-kicker--gold', role: 'status', style: 'margin-bottom: 9.2px; display: inline-flex' },
    h('span', { cls: 'va-streaming__dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), running ? 'Reading the vault' : 'Writing'));
  for (const b of m.blocks) {
    if (b.t === 'text') art.append(window.VAMarkdown.render(b.text, mdCtx));
    else if (b.t === 'tool') art.append(toolEl(b));
    else if (b.t === 'chips') art.append(chipsEl(b));
    else if (b.t === 'blocked') art.append(blockedEl(b));
  }
  if (writing) art.append(h('span', { cls: 'va-caret', 'aria-hidden': 'true' }));
  if (m.stopped) art.append(h('p', { cls: 'pr-side__m pr-stopped', text: 'Stopped' }));
  if (m.error) art.append(h('p', { cls: 'va-error-line', role: 'alert' }, icon('alert'), m.error.slice(0, 300),
    isLast ? btn('va-btn--ghost', { onClick: retry }, 'Retry') : null));
  if (m.done && !m.error) {
    const text = m.blocks.filter((b) => b.t === 'text').map((b) => b.text).join('\n\n');
    if (text) art.append(h('div', { cls: 'va-msg__actions' },
      iconBtn('copy', 'Copy reply', () => { VA.copy(text); toast('Reply copied.'); }, { title: 'Copy' }),
      iconBtn('filePlus', 'Save reply as a note', () => saveReply(text), { title: 'Save as note' })));
  }
  return art;
}
async function saveReply(text) {
  try {
    const title = (S.cur?.title || 'Reply').replace(/…$/, '');
    const rel = await VA.saveNote({ title, content: `# ${title}\n\n${text}\n` });
    toast(`Saved to ${rel}`, { action: 'Undo', onAction: async () => { await VA.undoCreate(rel); walkNotes(); } });
    walkNotes();
  } catch (e) { toast('Could not save the note.', { error: true }); }
}

function homeEl() {
  const hr = new Date().getHours();
  const part = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
  const quick = [
    ['pen', 'Add to today’s note', 'Append a line to today’s daily note', 'Add to today’s note: '],
    ['search', 'Find a note', 'Search your vault for what you wrote about…', 'Find my notes on '],
    ['align', 'Summarize a project', 'Gather what is open in a project', 'Summarize the project '],
    ['eye', 'Make observations', 'Spot patterns in this week’s notes', 'Make observations about this week’s notes.']
  ];
  return h('div', { cls: 'va-empty' },
    h('h2', { cls: 'va-display', text: `Good ${part}, ${S.cfg.name}.` }),
    h('p', { cls: 'va-empty__lede', text: `${S.noteCount.toLocaleString('en-GB')} notes in your vault. What should we work on?` }),
    h('div', { cls: 'va-quick' }, quick.map(([ic, t, d, fill]) =>
      h('button', { type: 'button', cls: 'va-quick__item', onClick: () => { S.draft = fill; R.ta.value = fill; autogrow(); focusComposer(); } },
        icon(ic), h('span', { cls: 'va-quick__title', text: t }), h('span', { cls: 'va-quick__desc', text: d })))));
}
function paintConvo() {
  if (!R.scroll) return;
  const near = R.scroll.scrollHeight - R.scroll.scrollTop - R.scroll.clientHeight < 80;
  const prev = R.scroll.scrollTop;
  R.scroll.replaceChildren();
  if (!S.cur || !S.cur.msgs.length) R.scroll.append(homeEl());
  else {
    const wrap = h('div', { cls: 'va-convo pr-convo' }, h('h2', { cls: 'va-sr', text: S.cur.title }));
    S.cur.msgs.forEach((m, i) => {
      if (m.role === 'user') wrap.append(h('article', { cls: 'pr-user', 'aria-label': `You said, ${m.time}` }, h('p', { cls: 'pr-user__body', text: m.text })));
      else wrap.append(botEl(m, i === S.cur.msgs.length - 1));
    });
    R.scroll.append(wrap);
  }
  R.scroll.scrollTop = near ? R.scroll.scrollHeight : prev;
  if (S.mini) paintMini();
}

// ---------- composer ----------
function autogrow() { const t = R.ta; t.style.height = 'auto'; t.style.height = Math.min(200, t.scrollHeight) + 'px'; }
function focusComposer() { (S.mini ? R.miniInput : R.ta)?.focus(); }
function paintComposer() {
  if (!R.sendSlot) return;
  R.sendSlot.replaceChildren(S.streaming
    ? btn('va-btn--icon va-send va-send--stop', { 'aria-label': 'Stop generating', title: 'Stop (Esc)', onClick: stop }, h('span', { cls: 'va-stop-sq', 'aria-hidden': 'true' }))
    : btn('va-btn--icon va-send', { id: 'sendbtn', 'aria-label': 'Send', title: 'Send (Enter)', disabled: !R.ta.value.trim(), onClick: () => send(R.ta.value) }, icon('up')));
  if (S.mini) paintMini();
}

// ---------- sidebar ----------
function paintSidebar() {
  if (!R.sideNotes) return;
  R.sideNotes.replaceChildren(...(S.notes.length
    ? S.notes.map((n) => h('li', null, h('button', { type: 'button', cls: 'pr-side', title: n.folder || 'Vault root', onClick: () => VA.openNote(n.file) },
      h('span', { cls: 'pr-side__t', text: n.title }), h('span', { cls: 'pr-side__m', text: relTime(n.mtimeMs) }))))
    : [h('li', { cls: 'pr-empty-side', text: 'No notes yet.' })]));
  const ordered = S.chats.slice().sort((a, b) => (b.pinned - a.pinned) || (b.when - a.when)).slice(0, 4);
  R.sideChats.replaceChildren(...(ordered.length
    ? ordered.map((c) => h('li', null, h('button', { type: 'button', cls: 'pr-side', 'aria-current': S.view === 'chat' && S.cur === c ? 'page' : null, onClick: () => openChat(c) },
      h('span', { cls: 'pr-side__t', text: c.title }), h('span', { cls: 'pr-side__m', text: chatMeta(c.when) }))))
    : [h('li', { cls: 'pr-empty-side', text: 'Conversations you have appear here.' })]));
  R.chatTotal.textContent = `All ${S.chats.length}`;
  R.vaultBtn.firstChild.textContent = `Vault · ${S.cfg.vaultName}`;
}
async function walkNotes() {
  try {
    S.notes = await VA.recentNotes();
    const info = await VA.vaultInfo();
    if (info.ok) S.noteCount = info.notes;
  } catch { /* ignore */ }
  paintSidebar();
  if (S.view === 'chat' && (!S.cur || !S.cur.msgs.length)) paintConvo();
}

// ---------- saved chats page ----------
function chatsPage() {
  const q = S.chatFilter.toLowerCase();
  let list = S.chats.filter((c) => !q || c.title.toLowerCase().includes(q) || c.msgs.some((m) => (m.text || (m.blocks || []).map((b) => b.text || '').join(' ')).toLowerCase().includes(q)));
  if (S.chatTab === 'pinned') list = list.filter((c) => c.pinned);
  if (S.chatTab === 'week') list = list.filter((c) => Date.now() - c.when < 6 * 86400000 || sameDay(new Date(c.when), new Date()));
  list.sort((a, b) => b.when - a.when);
  const pinned = S.chats.filter((c) => c.pinned).length;
  const root = h('div', { style: 'max-width:620px;margin:0 auto;padding:23px 27.6px 36.8px' });
  root.append(h('div', { style: 'display:flex;align-items:baseline;gap:13.8px;margin-bottom:13.8px' },
    h('h2', { cls: 'va-h1', id: 'chats-h', style: 'font-size:22px;line-height:28px', text: 'Saved chats' }),
    h('span', { cls: 'pr-side__m', text: `${S.chats.length} saved · ${pinned} pinned` })));
  const filter = h('input', { cls: 'pr-text', id: 'cl-filter', type: 'search', placeholder: 'Filter by title or text…', value: S.chatFilter });
  filter.addEventListener('input', () => { S.chatFilter = filter.value; const pos = filter.selectionStart; paintMain(); const f = document.getElementById('cl-filter'); f.focus(); f.setSelectionRange(pos, pos); });
  const tabs = [['all', 'All'], ['pinned', 'Pinned'], ['week', 'This week']];
  root.append(h('div', { style: 'display:flex;align-items:flex-end;gap:18.4px;margin-bottom:4.6px' },
    h('div', { cls: 'pr-field', style: 'flex:1' }, h('label', { cls: 'va-sr', for: 'cl-filter', text: 'Filter saved chats' }), filter),
    seg('Show', tabs, S.chatTab, (v) => { S.chatTab = v; paintMain(); })));
  for (const label of ['Today', 'This week', 'Earlier']) {
    const items = list.filter((c) => chatGroup(c.when) === label);
    if (!items.length) continue;
    root.append(h('h3', { cls: 'va-kicker', style: 'margin:18.4px 0 0;padding-bottom:4.6px;border-bottom:1px solid var(--divider)', text: label }));
    root.append(h('ul', { cls: 'va-list' }, items.map(chatRow)));
  }
  if (!list.length) root.append(h('div', { style: 'padding:46px 0;border-bottom:1px solid var(--divider)' },
    h('p', { style: 'font:400 16px/25px var(--font-display);color:var(--text-secondary);margin:0 0 9.2px', text: S.chats.length ? 'No chats match.' : 'No saved chats yet. Start a conversation and it will appear here.' }),
    S.chatFilter || S.chatTab !== 'all' ? btn('va-btn--ghost', { style: 'margin-left:-18.4px', onClick: () => { S.chatFilter = ''; S.chatTab = 'all'; paintMain(); } }, 'Clear filter') : null));
  return h('main', { cls: 'pr-scroll', style: 'min-height:0', 'aria-labelledby': 'chats-h' }, root);
}
function chatRow(c) {
  const preview = (c.msgs.find((m) => m.role === 'user') || {}).text || '';
  if (S.renaming === c.id) {
    const inp = h('input', { cls: 'pr-text', id: 'rn-input', value: c.title, style: 'font:500 14px/20px var(--font-body)' });
    const commit = () => { if (S.renaming !== c.id) return; c.title = inp.value.trim() || c.title; S.renaming = null; persist(); paintAll(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { S.renaming = null; paintMain(); } });
    inp.addEventListener('blur', commit);
    setTimeout(() => inp.focus(), 0);
    return h('li', { cls: 'pr-cl' }, h('div', { style: 'padding:9.2px 18.4px' }, h('label', { cls: 'va-sr', for: 'rn-input', text: 'Rename chat' }), inp));
  }
  return h('li', { cls: 'pr-cl' },
    h('button', { type: 'button', cls: 'pr-cl__open', onClick: () => openChat(c) },
      h('span', { style: 'display:flex;align-items:baseline;gap:9.2px;min-width:0' },
        h('span', { style: 'font:500 14px/20px var(--font-body);white-space:nowrap;overflow:hidden;text-overflow:ellipsis', text: c.title }),
        c.pinned ? h('span', { cls: 'va-kicker va-kicker--gold', style: 'font-size:9.5px', text: 'Pinned' }) : null,
        h('span', { cls: 'pr-side__m', style: 'margin-left:auto', text: chatMeta(c.when) })),
      h('span', { style: 'font:400 12.5px/18px var(--font-body);color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis', text: preview })),
    h('div', { cls: 'pr-cl__acts' },
      iconBtn('pin', c.pinned ? 'Unpin ' + c.title : 'Pin ' + c.title, () => { c.pinned = !c.pinned; persist(); paintAll(); }, { title: c.pinned ? 'Unpin' : 'Pin', attrs: { 'aria-pressed': String(!!c.pinned) } }),
      iconBtn('pen', 'Rename ' + c.title, () => { S.renaming = c.id; paintMain(); }, { title: 'Rename' }),
      iconBtn('trash', 'Delete ' + c.title, () => deleteChat(c), { title: 'Delete' })));
}
function deleteChat(c) {
  const idx = S.chats.indexOf(c);
  S.chats.splice(idx, 1);
  if (S.cur === c) S.cur = null;
  persist(); paintAll();
  toast('Chat deleted.', { action: 'Undo', onAction: () => { S.chats.splice(idx, 0, c); persist(); paintAll(); } });
}
function seg(label, opts, value, onPick) {
  const g = h('div', { cls: 'va-seg', role: 'radiogroup', 'aria-label': label });
  const btns = opts.map(([v, l]) => h('button', { type: 'button', cls: 'va-seg__opt', role: 'radio', 'aria-checked': String(v === value), tabindex: v === value ? '0' : '-1', text: l }));
  btns.forEach((b, i) => {
    b.addEventListener('click', () => onPick(opts[i][0]));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (d) { e.preventDefault(); onPick(opts[(i + d + opts.length) % opts.length][0]); setTimeout(() => g.querySelector('[aria-checked="true"]')?.focus(), 0); }
    });
  });
  g.append(...btns);
  return g;
}

// ---------- search palette ----------
const PAL_ACTIONS = [
  ['New conversation', () => newChat()],
  ['Show all saved chats', () => { S.view = 'chats'; paintAll(); }],
  ['Add to today’s note', () => { newChat(); R.ta.value = S.draft = 'Add to today’s note: '; autogrow(); focusComposer(); }],
  ['Settings', () => openSettings()]
];
async function palRefresh() {
  const q = S.pal.q.trim(), lq = q.toLowerCase();
  const notes = q ? await VA.searchNotes(q) : S.notes;
  const chats = S.chats.filter((c) => !lq || c.title.toLowerCase().includes(lq)).slice(0, 5);
  const actions = PAL_ACTIONS.filter(([l]) => !lq || l.toLowerCase().includes(lq));
  S.pal.groups = [
    ['Notes', notes.map((n) => ({ icon: 'file', title: n.title, sub: n.folder, run: () => VA.openNote(n.file) }))],
    ['Saved chats', chats.map((c) => ({ icon: 'chat', title: c.title, sub: chatMeta(c.when), run: () => openChat(c) }))],
    ['Actions', actions.map(([l, fn]) => ({ icon: 'chevron', title: l, sub: '', run: fn }))]
  ].filter(([, items]) => items.length);
  S.pal.flat = S.pal.groups.flatMap(([, items]) => items);
  S.pal.sel = Math.min(S.pal.sel, Math.max(0, S.pal.flat.length - 1));
  paintPalette();
}
function openPalette() { S.pal = { q: '', sel: 0, groups: [], flat: [] }; paintPalette(true); palRefresh(); }
function closePalette() { S.pal = null; paintPalette(); focusComposer(); }
function paintPalette(focus) {
  R.win.querySelectorAll('.pr-scrim, .pr-pal').forEach((n) => n.remove());
  if (!S.pal) return;
  const p = S.pal;
  const input = h('input', { id: 'pal-q', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-activedescendant': `pal-${p.sel}`, placeholder: 'Search notes, chats and actions…', value: p.q, autocomplete: 'off' });
  input.addEventListener('input', () => { p.q = input.value; p.sel = 0; palRefresh(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); p.sel = Math.min(p.flat.length - 1, p.sel + 1); paintPalette(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); p.sel = Math.max(0, p.sel - 1); paintPalette(true); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = p.flat[p.sel]; if (r) { closePalette(); r.run(); } else if (p.q.trim()) askPalette(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  const askPalette = () => { const q = p.q.trim(); closePalette(); newChat(); send(q); };
  let n = 0;
  const list = h('div', { id: 'pal-list', role: 'listbox', 'aria-label': 'Results', cls: 'pr-scroll', style: 'max-height:400px;padding:4.6px 0 9.2px' });
  for (const [label, items] of p.groups) {
    const g = h('div', { role: 'group', 'aria-label': label }, h('div', { cls: 'va-kicker', style: 'padding:13.8px 18.4px 4.6px', text: label }));
    for (const r of items) {
      const i = n++;
      const row = h('button', { type: 'button', cls: 'pr-row' + (i === p.sel ? ' is-sel' : ''), role: 'option', id: `pal-${i}`, 'aria-selected': String(i === p.sel), tabindex: '-1',
        onClick: () => { closePalette(); r.run(); }, onMouseEnter: () => { p.sel = i; list.querySelectorAll('.pr-row').forEach((x, j) => { x.classList.toggle('is-sel', j === i); x.setAttribute('aria-selected', String(j === i)); }); } },
        icon(r.icon), h('span', { cls: 'pr-row__t', text: r.title }), h('span', { cls: 'pr-row__s', text: r.sub }));
      g.append(row);
    }
    list.append(g);
  }
  if (!p.flat.length) list.append(h('div', { style: 'padding:27.6px 18.4px' },
    h('p', { style: 'margin:0 0 4.6px;font:400 16px/25px var(--font-display);color:var(--text-secondary)', text: `Nothing matches “${p.q}”.` }),
    btn('va-btn--ghost', { style: 'margin-left:-18.4px', onClick: askPalette }, 'Ask the assistant instead')));
  R.win.append(h('div', { cls: 'pr-scrim', onClick: closePalette }),
    h('div', { cls: 'pr-pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' },
      h('div', { cls: 'pr-pal__in' }, icon('search'), h('label', { cls: 'va-sr', for: 'pal-q', text: 'Search notes, chats and actions' }), input, iconBtn('x', 'Close search', closePalette)),
      list,
      h('div', { style: 'display:flex;gap:18.4px;padding:9.2px 18.4px;border-top:1px solid var(--divider)' },
        h('span', { cls: 'va-caption', text: '↑ ↓ to move' }), h('span', { cls: 'va-caption', text: 'Enter to open' }), h('span', { cls: 'va-caption', text: 'Esc to close' }))));
  if (focus || !document.activeElement || document.activeElement === document.body) { const el = document.getElementById('pal-q'); el.focus(); el.setSelectionRange(p.q.length, p.q.length); }
}

// ---------- settings dialog ----------
async function openSettings() {
  const cfg = await VA.getConfig();
  let scope = cfg.readScope;
  const dlg = h('dialog', { cls: 'va-dialog', 'aria-labelledby': 'st-h' });
  const vault = h('input', { cls: 'va-input', id: 'st-vault', value: cfg.vaultWin });
  const help = h('p', { cls: 'va-help', id: 'st-vault-help' });
  const claude = h('input', { cls: 'va-input', id: 'st-claude', value: cfg.claudePath });
  const name = h('input', { cls: 'va-input', id: 'st-name', value: cfg.name, style: 'font-family:var(--font-body);font-size:14px' });
  const scopeHelp = h('p', { cls: 'va-help' });
  const scopeHost = h('div');
  const paintScope = () => {
    scopeHost.replaceChildren(seg('Reading scope', [['machine', 'Whole machine'], ['vault', 'Vault only']], scope, (v) => { scope = v; paintScope(); }));
    scopeHelp.textContent = scope === 'machine' ? 'It can read files anywhere on this PC to answer questions.' : 'It can read only inside your vault.';
  };
  const check = async () => {
    const r = await VA.vaultInfo(vault.value);
    vault.setAttribute('aria-invalid', String(!r.ok));
    help.className = 'va-help' + (r.ok ? '' : ' va-help--error');
    help.replaceChildren(...(r.ok ? [`Obsidian vault found · ${r.notes.toLocaleString('en-GB')} notes in ${r.folders.toLocaleString('en-GB')} folders.`] : [icon('alert', 'va-icon--sm'), r.reason]));
    return r.ok;
  };
  vault.addEventListener('change', check);
  paintScope(); check();
  const row = (label, id, ...ctl) => h('div', { cls: 'va-setting' }, h('label', { cls: 'va-kicker va-setting__label', for: id, text: label }), h('div', { cls: 'va-setting__ctl' }, ...ctl));
  dlg.append(
    h('div', { cls: 'va-dialog__head' }, h('h2', { cls: 'va-h1', id: 'st-h', text: 'Settings' }), iconBtn('x', 'Close settings', () => dlg.close())),
    h('div', { cls: 'va-dialog__body' },
      row('Vault folder', 'st-vault', h('div', { cls: 'va-row' }, vault, btn('va-btn--ghost', { onClick: async () => { const p = await VA.pickFolder(); if (p) { vault.value = p; check(); } } }, 'Browse')), help),
      h('div', { cls: 'va-setting' }, h('span', { cls: 'va-kicker va-setting__label', text: 'Can read' }), h('div', { cls: 'va-setting__ctl' }, scopeHost, scopeHelp)),
      h('div', { cls: 'va-setting' }, h('span', { cls: 'va-kicker va-setting__label', text: 'Can write' }),
        h('div', { cls: 'va-blocked', role: 'note', style: 'margin:0' }, icon('lock'), h('div', { cls: 'va-blocked__body' },
          h('span', { cls: 'va-kicker', text: 'Vault only · fixed' }),
          h('p', { cls: 'va-blocked__text', text: 'Files elsewhere are read-only. A request to change one is written as a new note inside the vault.' })))),
      row('Claude CLI (in WSL)', 'st-claude', claude),
      row('Your name', 'st-name', name)),
    h('div', { cls: 'va-dialog__foot' },
      btn('va-btn--ghost', { onClick: () => dlg.close() }, 'Cancel'),
      btn('va-btn--primary', { onClick: async () => {
        if (!(await check())) return;
        S.cfg = await VA.setConfig({ vaultWin: vault.value, claudePath: claude.value, readScope: scope, name: name.value });
        dlg.close(); toast('Settings saved.'); walkNotes(); paintAll();
      } }, 'Save')));
  dlg.addEventListener('close', () => { dlg.remove(); focusComposer(); });
  R.win.append(dlg);
  dlg.showModal();
}

// ---------- mini mode ----------
function toggleMini() {
  S.mini = !S.mini;
  VA.win.mini(S.mini);
  mount();
}
function paintMini() {
  if (!R.miniStatus) return;
  const bot = lastBot();
  R.miniStatus.textContent = S.streaming ? (bot?.blocks.some((b) => b.t === 'tool' && b.status === 'running') ? 'Reading the vault' : 'Writing') : bot?.done && !bot.error ? 'Done' : bot?.error ? 'Failed' : 'Quick capture';
  R.miniSend.replaceChildren(S.streaming
    ? btn('va-btn--icon va-send va-send--stop', { 'aria-label': 'Stop generating', onClick: stop }, h('span', { cls: 'va-stop-sq', 'aria-hidden': 'true' }))
    : btn('va-btn--icon va-send', { 'aria-label': 'Send', onClick: () => { const v = R.miniInput.value; R.miniInput.value = ''; send(v); }, disabled: !R.miniInput.value.trim() }, icon('up')));
}
function buildMini() {
  R.miniInput = h('input', { type: 'text', placeholder: 'Capture a note or ask…', 'aria-label': 'Message', autocomplete: 'off' });
  R.miniInput.addEventListener('input', paintMini);
  R.miniInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const v = R.miniInput.value; R.miniInput.value = ''; send(v); } });
  R.miniStatus = h('span', { cls: 'va-kicker va-kicker--gold', role: 'status' });
  R.miniSend = h('span');
  const root = h('div', { cls: 'va-mini', 'data-theme': 'colophon' },
    icon('book', 'va-masthead__mark'),
    h('div', { cls: 'va-mini__field' }, R.miniStatus, R.miniInput),
    R.miniSend,
    iconBtn('max', 'Return to window', toggleMini, { title: 'Return to window (Ctrl M)' }));
  return root;
}

// ---------- shell ----------
const R = {};
function buildShell() {
  R.ta = h('textarea', { id: 'cmp', rows: '1', placeholder: 'Ask about your vault, or tell it what to write…' });
  R.ta.value = S.draft;
  R.ta.addEventListener('input', () => { S.draft = R.ta.value; autogrow(); paintComposer(); });
  R.ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(R.ta.value); } });
  R.sendSlot = h('span');
  R.scroll = h('div', { cls: 'va-pane__scroll' });
  R.pane = h('main', { cls: 'va-pane', 'data-theme': 'colophon', style: 'background:var(--bg);color:var(--text);min-height:0' },
    R.scroll,
    h('div', { cls: 'va-pane__composer' },
      h('div', { cls: 'va-composer' }, h('label', { cls: 'va-sr', for: 'cmp', text: 'Message' }), h('div', { cls: 'va-composer__field' }, R.ta, R.sendSlot)),
      h('p', { cls: 'pr-foot', text: S.cfg.readScope === 'vault' ? 'Reads only inside your vault · writes only inside your vault' : 'Reads anywhere on this PC · writes only inside your vault' })));
  R.sideNotes = h('ul', { cls: 'va-list' });
  R.sideChats = h('ul', { cls: 'va-list' });
  R.chatTotal = h('button', { type: 'button', cls: 'pr-link', onClick: () => { S.view = 'chats'; paintAll(); } });
  R.vaultBtn = btn('va-btn--ghost', { title: 'Settings', style: 'min-width:0;padding:0 9.2px;margin-left:-9.2px;text-transform:none;letter-spacing:0;font:400 12.5px/18px var(--font-body);color:var(--text-meta);overflow:hidden', onClick: openSettings }, h('span', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }));
  R.vaultBtn.firstChild.textContent = `Vault · ${S.cfg.vaultName}`;
  const side = h('nav', { cls: 'va-sidebar', 'aria-label': 'Vault' },
    h('div', { cls: 'pr-scroll', style: 'flex:1;min-height:0' },
      h('section', { cls: 'pr-sec' }, h('h2', { cls: 'va-kicker pr-sec__head', text: 'Recent notes' }), R.sideNotes),
      h('section', { cls: 'pr-sec' }, h('div', { cls: 'pr-sec__head' }, h('h2', { cls: 'va-kicker', style: 'margin:0', text: 'Saved chats' }), R.chatTotal), R.sideChats)),
    h('div', { cls: 'va-sidebar__foot' }, R.vaultBtn, iconBtn('search', 'Search the vault and chats', openPalette, { title: 'Search (Ctrl K)' })));
  R.chatsBtn = iconBtn('chat', 'Saved chats', () => { S.view = S.view === 'chats' ? 'chat' : 'chats'; paintAll(); }, { title: 'Saved chats' });
  const head = h('header', { cls: 'va-masthead' },
    icon('book', 'va-masthead__mark'),
    h('h1', { cls: 'va-masthead__name', text: 'Rook' }),
    h('span', { cls: 'va-kicker va-masthead__date', text: mastDate() }),
    h('div', { cls: 'va-masthead__actions' },
      iconBtn('plus', 'New conversation', newChat, { title: 'New conversation (Ctrl N)' }),
      iconBtn('search', 'Search', openPalette, { title: 'Search (Ctrl K)' }),
      R.chatsBtn,
      iconBtn('settings', 'Settings', openSettings, { title: 'Settings (Ctrl ,)' })),
    h('div', { cls: 'va-winctl', 'aria-label': 'Window controls' },
      h('button', { type: 'button', 'aria-label': 'Minimise', onClick: () => VA.win.minimize() }, icon('minus')),
      h('button', { type: 'button', 'aria-label': 'Maximise', onClick: () => VA.win.maximize() }, icon('square')),
      h('button', { type: 'button', cls: 'close', 'aria-label': 'Close', onClick: () => VA.win.close() }, icon('x'))));
  R.centerHost = h('div', { style: 'display:contents' });
  R.win = h('div', { cls: 'va-window', style: 'font-family:var(--font-body);color:var(--text)' }, head, h('div', { cls: 'va-main' }, side, R.centerHost));
  return R.win;
}
function paintMain() {
  if (S.view === 'chats') { R.centerHost.replaceChildren(chatsPage()); }
  else if (R.centerHost.firstChild !== R.pane) { R.centerHost.replaceChildren(R.pane); }
  if (S.view === 'chat') paintConvo();
  R.chatsBtn.setAttribute('aria-pressed', String(S.view === 'chats'));
}
function paintAll() { paintSidebar(); paintMain(); paintComposer(); paintToast(); if (S.view === 'chat') autogrow(); }
function mount() {
  const app = document.getElementById('app');
  if (S.mini) { app.replaceChildren(buildMini()); paintMini(); R.miniInput.focus(); }
  else { app.replaceChildren(buildShell()); paintAll(); focusComposer(); }
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'n') { e.preventDefault(); newChat(); }
  else if (e.ctrlKey && k === 'k') { e.preventDefault(); S.pal ? closePalette() : openPalette(); }
  else if (e.ctrlKey && k === 'm') { e.preventDefault(); toggleMini(); }
  else if (e.ctrlKey && k === ',') { e.preventDefault(); openSettings(); }
  else if (e.key === 'Escape') { if (S.pal) closePalette(); else if (S.streaming) stop(); }
  else if (e.key === 'F6') {
    e.preventDefault();
    const regions = [...document.querySelectorAll('.va-masthead__actions button, .va-sidebar .pr-side, #cmp')].filter((x) => x.offsetParent);
    const groups = [regions.find((x) => x.closest('.va-masthead')), regions.find((x) => x.closest('.va-sidebar')), document.getElementById('cmp') || document.querySelector('main')].filter(Boolean);
    const i = groups.indexOf(document.activeElement.closest('.va-masthead') ? groups[0] : document.activeElement.closest('.va-sidebar') ? groups[1] : groups[2]);
    groups[(i + 1) % groups.length]?.focus();
  }
});

// ---------- boot ----------
(async function boot() {
  S.cfg = await VA.getConfig();
  S.chats = (await VA.loadChats()) || [];
  for (const c of S.chats) for (const m of c.msgs) if (m.role === 'bot' && !m.done) { m.done = true; m.stopped = true; }
  mount();
  walkNotes();
  setInterval(() => { if (!S.streaming) walkNotes(); }, 30000);
})();
