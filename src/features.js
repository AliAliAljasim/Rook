'use strict';
/* Rook features that sit on top of the core renderer: answer buttons, the search palette, the change
   viewer, the /agent popup, attachments and the theme. This file loads before renderer.js and only
   defines things; everything in it runs later, when the renderer calls it. */

// ---------- answer buttons ----------
// Rook ends a question with <choices>- option ...</choices>. The block is taken out of the text and shown as buttons.
function splitChoices(text) {
  const src = String(text || '');
  const i = src.lastIndexOf('<choices>');
  if (i < 0) return { text: src.replace(/<c(h(o(i(c(e(s)?)?)?)?)?)?$/, ''), choices: [] }; // hide a tag that is still streaming in
  const body = src.slice(i + 9), j = body.indexOf('</choices>');
  const choices = j < 0 ? [] : body.slice(0, j).split('\n').map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean).slice(0, 4);
  return { text: src.slice(0, i).trimEnd(), choices };
}

// ---------- modal layer (search palette, change viewer) ----------
let modalOnClose = null;
function openModal(node, opts = {}) {
  closeModal();
  const layer = $('modal-layer');
  const box = h('div', { cls: 'modal ' + (opts.cls || ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || '' }, node);
  layer.replaceChildren(box);
  layer.classList.remove('hidden');
  layer.onmousedown = (e) => { if (e.target === layer) closeModal(); };
  modalOnClose = opts.onClose || null;
}
function closeModal() {
  const layer = $('modal-layer');
  if (layer.classList.contains('hidden')) return false;
  layer.classList.add('hidden'); layer.replaceChildren();
  const f = modalOnClose; modalOnClose = null; if (f) f();
  return true;
}
const modalOpen = () => !$('modal-layer').classList.contains('hidden');

// ---------- search palette ----------
let paletteSeq = 0;
function openPalette() {
  if (S.mini === 'bar') setMini(false);
  const input = h('input', { type: 'text', cls: 'pal-input', placeholder: 'Search notes and chats…', 'aria-label': 'Search notes and chats', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { cls: 'pal-list', role: 'listbox' });
  let items = [], sel = 0, timer;
  const run = (it) => { closeModal(); it.run(); };
  const draw = () => {
    const out = []; let group = null;
    items.forEach((it, i) => {
      if (it.group !== group) { group = it.group; out.push(h('div', { cls: 'pal-group', text: group })); }
      out.push(h('button', { type: 'button', cls: 'pal-item' + (i === sel ? ' on' : ''), role: 'option', 'aria-selected': String(i === sel), onClick: () => run(it), onMousemove: () => { if (sel !== i) { sel = i; draw(); } } },
        h('span', { cls: 'row-cover' }, icon(it.icon, 'sm')),
        h('span', { cls: 'row-meta' }, h('span', { cls: 'row-title', text: it.title }), it.sub ? h('span', { cls: 'row-sub', text: it.sub }) : null),
        it.time ? h('span', { cls: 'row-time', text: it.time }) : null));
    });
    if (!items.length) out.push(h('p', { cls: 'empty', text: input.value.trim().length < 2 ? 'Type at least two letters.' : 'Nothing matches.' }));
    list.replaceChildren(...out);
    const on = list.querySelector('.pal-item.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const noteItem = (n) => ({ group: 'Notes', icon: 'file', title: n.title, sub: n.snippet || n.folder || 'Vault', time: n.mtimeMs ? relTime(n.mtimeMs) : '', run: () => openNote(n.file) });
  const chatItem = (c) => ({ group: 'Chats', icon: 'chat', title: c.title, sub: chatPreview(c), time: chatMeta(c.when), run: () => openChat(c) });
  const search = async () => {
    const q = input.value.trim(), lq = q.toLowerCase(), seq = ++paletteSeq;
    if (q.length < 2) {
      items = [...S.all.slice().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5).map(noteItem), ...S.chats.slice().sort((a, b) => b.when - a.when).slice(0, 5).map(chatItem)];
      sel = 0; return draw();
    }
    const chats = S.chats.filter((c) => c.title.toLowerCase().includes(lq) || c.msgs.some((m) => (m.text || (m.blocks || []).map((b) => b.text || '').join(' ')).toLowerCase().includes(lq))).slice(0, 6);
    let notes = [];
    try { notes = await VA.searchNotes(q); } catch { /* vault unavailable */ }
    if (seq !== paletteSeq) return;
    items = [...notes.map(noteItem), ...chats.map(chatItem),
      { group: 'Ask', icon: 'chat', title: `Ask Rook about “${q.length > 48 ? q.slice(0, 47) + '…' : q}”`, sub: 'Starts a new conversation', run: () => { S.cur = null; send(q); } }];
    sel = 0; draw();
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 140); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; draw(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) run(items[sel]); }
  });
  openModal(h('div', { cls: 'pal' }, h('label', { cls: 'pal-top' }, icon('search', 'sm'), input, h('kbd', { text: 'Esc' })), list), { cls: 'modal-pal', label: 'Search' });
  search();
  input.focus();
}

// ---------- change viewer: what Rook changed in a note, and putting it back ----------
// Line diff: common start and end are skipped, the middle is compared with a longest-common-subsequence table.
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length; while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const ops = A.slice(0, s).map((t) => [' ', t]);
  const x = A.slice(s, ea), y = B.slice(s, eb), n = x.length, m = y.length;
  if (n * m > 4e6) { for (const t of x) ops.push(['-', t]); for (const t of y) ops.push(['+', t]); } // too big to align: old then new
  else {
    const w = m + 1, T = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i * w + j] = x[i] === y[j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { ops.push([' ', x[i]]); i++; j++; }
      else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) ops.push(['-', x[i++]]);
      else ops.push(['+', y[j++]]);
    }
    while (i < n) ops.push(['-', x[i++]]);
    while (j < m) ops.push(['+', y[j++]]);
  }
  for (const t of A.slice(ea)) ops.push([' ', t]);
  return ops;
}
function diffNodes(ops) {
  const keep = new Uint8Array(ops.length);
  ops.forEach(([t], i) => { if (t !== ' ') for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++) keep[k] = 1; });
  const out = []; let gap = false, shown = 0;
  ops.forEach(([t, text], i) => {
    if (!keep[i]) { if (!gap && shown) out.push(h('div', { cls: 'diff-gap', text: '⋯' })); gap = true; return; }
    if (shown >= 400) return;
    gap = false; shown++;
    out.push(h('div', { cls: 'diff-line ' + (t === '+' ? 'add' : t === '-' ? 'del' : '') }, h('span', { cls: 'diff-sign', text: t === ' ' ? '' : t }), h('span', { text: text || ' ' })));
  });
  if (shown >= 400) out.push(h('div', { cls: 'diff-gap', text: 'Long change: the rest is not shown.' }));
  return out;
}
async function openChanges(c) {
  let r;
  try { r = await VA.change.get({ id: c.id, rel: c.path }); } catch { return toast('That change could not be loaded.', { error: true }); }
  const created = c.backup === 'new';
  let body, note = '';
  if (r.now == null) body = h('p', { cls: 'empty', text: 'This note is no longer in the vault.' });
  else if (created || r.before == null) {
    note = created ? 'Rook created this note. This is what is in it now.' : 'The earlier version of this note was not kept, so only the current text can be shown.';
    body = h('div', { cls: 'diff' }, diffNodes(r.now.split('\n').map((t) => [created ? '+' : ' ', t])));
    if (!created) body.classList.add('plain');
  } else {
    const ops = lineDiff(r.before, r.now);
    const add = ops.filter((o) => o[0] === '+').length, del = ops.filter((o) => o[0] === '-').length;
    note = add || del ? `${add} line${add === 1 ? '' : 's'} added, ${del} removed since before this change.` : 'The note now reads the same as before this change.';
    body = add || del ? h('div', { cls: 'diff' }, diffNodes(ops)) : h('p', { cls: 'empty', text: 'No differences.' });
  }
  const canRevert = r.now != null && (created || r.hasBackup);
  const revert = async () => {
    try {
      if (!(await VA.change.revert({ id: c.id, rel: c.path, created }))) throw new Error('nothing to restore');
      c.reverted = true; persist(); closeModal(); loadNotes(); scheduleChat();
      toast(created ? 'Note moved to the Recycle Bin.' : 'Note put back as it was.');
    } catch { toast('That change could not be undone.', { error: true }); }
  };
  openModal(h('div', { cls: 'chg' },
    h('div', { cls: 'chg-head' }, h('div', null, h('span', { cls: 'eyebrow', text: created ? 'Created' : 'Changed' }), h('h2', { text: c.path })),
      tool('x', 'Close', closeModal)),
    note ? h('p', { cls: 'chg-note', text: note }) : null,
    body,
    h('div', { cls: 'chg-foot' },
      r.now != null ? pill('pill-ghost', 'Open note', () => { closeModal(); openNote(c.path); }, 'file') : null,
      canRevert ? pill('pill-ghost', created ? 'Move to Recycle Bin' : 'Put it back as it was', revert, 'undo') : null)), { cls: 'modal-chg', label: 'Changes to ' + c.path });
}

// ---------- the popup above the ask box: slash commands and /agent ----------
const EFFORT_LABEL = { '': 'Auto', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const agentLabel = () => [S.cfg.model ? cap(S.cfg.model) : '', S.cfg.effort ? `${EFFORT_LABEL[S.cfg.effort].toLowerCase()} effort` : ''].filter(Boolean).join(', ');
const SLASH = [
  { cmd: '/agent', desc: 'Choose the model and how hard it thinks', run: () => openAgentPop() },
  { cmd: '/clip', desc: 'Save a web page to the vault: /clip https://…', arg: true, run: (arg) => runClip(arg) }
];
let popKind = null; // 'slash' | 'agent' | 'voice' | 'note' | null
function closePop() { if (!popKind) return false; popKind = null; $('ask-pop').classList.add('hidden'); $('ask-pop').replaceChildren(); return true; }
function showPop(kind, ...nodes) { popKind = kind; const p = $('ask-pop'); p.replaceChildren(...nodes); p.classList.remove('hidden'); }
// "/ag" lists the commands that start that way; "/clip https://…" is a command with its argument.
function slashMatches(value) {
  const m = /^(\/\S*)(\s+(.*))?$/.exec(value);
  if (!m) return [];
  const head = m[1].toLowerCase();
  return m[2] === undefined ? SLASH.filter((c) => c.cmd.startsWith(head)) : SLASH.filter((c) => c.arg && c.cmd === head);
}
const slashArg = (value) => (/^\/\S*\s+(.*)$/.exec(value) || [])[1] || '';
// A message that is nothing but a web address: Rook cannot browse, so what it can do with it is clip the page.
const CLIP_URL = { cmd: 'Clip this page', desc: 'Fetch it and save a summary note to the vault', url: true };
// Called as the user types: a message starting with "/" lists the commands that match.
function updateSlash(value) {
  const hits = URL_ONLY.test(value.trim()) ? [CLIP_URL] : slashMatches(value);
  if (!hits.length) { if (popKind === 'slash') closePop(); return; }
  showPop('slash', ...hits.map((c) => h('button', { type: 'button', cls: 'pop-cmd', onClick: () => runSlash(c, value) }, h('b', { text: c.cmd }), h('span', { text: c.desc }))));
}
function runSlash(c, value) {
  const arg = c.url ? value.trim() : slashArg(value).trim();
  if (c.arg && !arg) { // the command needs something after it: leave it in the box, ready for the rest
    $('ask').value = c.cmd + ' '; autogrow(); paintAsk(); closePop(); focusAsk();
    return;
  }
  $('ask').value = ''; autogrow(); paintAsk(); closePop();
  if (c.url) runClip(arg); else c.run(arg);
}
// Enter on a "/..." message, or on a lone web address, runs the command instead of sending it. Returns true when it did.
function trySlash(value) {
  const v = value.trim();
  const hits = URL_ONLY.test(v) ? [CLIP_URL] : slashMatches(v);
  if (!hits.length) return false;
  runSlash(hits[0], v);
  return true;
}
function openAgentPop() {
  const models = ['', ...(S.cfg.models || [])], efforts = ['', ...(S.cfg.efforts || [])];
  const set = async (patch) => { S.cfg = await VA.setConfig({ ...S.cfg, ...patch }); paintAsk(); draw(); };
  const draw = () => {
    const slider = h('input', { type: 'range', min: '0', max: String(efforts.length - 1), step: '1', value: String(Math.max(0, efforts.indexOf(S.cfg.effort))), 'aria-label': 'Effort', cls: 'pop-range' });
    const val = h('span', { cls: 'pop-val', text: EFFORT_LABEL[S.cfg.effort] || 'Auto' });
    slider.addEventListener('input', () => { val.textContent = EFFORT_LABEL[efforts[Number(slider.value)]]; });
    slider.addEventListener('change', () => set({ effort: efforts[Number(slider.value)] }));
    showPop('agent',
      h('div', { cls: 'pop-head' }, h('span', { cls: 'eyebrow', text: 'Agent' }), tool('x', 'Close', () => { closePop(); focusAsk(); })),
      h('div', { cls: 'pop-row' }, h('span', { cls: 'pop-label', text: 'Model' }),
        seg(models.map((m) => [m, m ? cap(m) : 'Auto']), S.cfg.model || '', (v) => set({ model: v }), 'Model')),
      h('div', { cls: 'pop-row' }, h('span', { cls: 'pop-label', text: 'Effort' }), slider, val),
      h('div', { cls: 'pop-ticks', 'aria-hidden': 'true' }, h('span', { text: 'Auto' }), h('span', { text: 'Max' })),
      h('p', { cls: 'pop-help', text: 'Auto leaves the choice to Claude. Changes apply from your next message.' }));
    const s = $('ask-pop').querySelector('.pop-range'); if (document.activeElement === document.body) s.focus();
  };
  draw();
}

// ---------- attachments: files dropped, pasted or picked are filed in the vault and named in the message ----------
const ATTACH = []; // { name, rel } waiting to go out with the next message
async function addFiles(fileList) {
  const files = [...fileList].slice(0, 8);
  if (!files.length) return;
  if (S.mini === 'bar') setMini('panel');
  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is larger than 25 MB.`, { error: true }); continue; }
    try {
      const d = new Date();
      const name = /^image\.(png|jpe?g)$/i.test(f.name || '') || !f.name ? `Pasted ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` : f.name;
      const rel = await VA.attach({ name, bytes: new Uint8Array(await f.arrayBuffer()) });
      ATTACH.push({ name: rel.split('/').pop(), rel });
    } catch (e) { toast(`${f.name || 'That file'} could not be attached.`, { error: true }); }
  }
  paintAsk(); focusAsk();
}
function attachNodes() {
  return ATTACH.map((a, i) => h('span', { cls: 'ask-ctx', title: a.rel }, icon(/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.name) ? 'image' : 'file', 'sm'), h('span', { text: a.name }),
    h('button', { type: 'button', 'aria-label': `Remove ${a.name}`, title: 'Remove (its copy in the vault goes to the Recycle Bin)', onClick: () => { ATTACH.splice(i, 1); VA.attachDiscard(a.rel); paintAsk(); } }, icon('x', 'sm'))));
}
// Once a message is sent its attachments are part of the conversation and are kept.
function takeAttachments() { const out = ATTACH.splice(0, ATTACH.length); if (out.length) VA.attachSent(out.map((a) => a.rel)); return out; }

// ---------- voice: hold to talk ----------
// Hold the microphone button (or the voice shortcut), speak, let go: the words are typed into the ask box.
// Sound is recorded here, converted to the 16 kHz mono WAV the engine wants, and transcribed on this PC.
const VOICE = { state: 'idle', rec: null, stream: null, chunks: [], startedAt: 0, status: { installed: false, installing: false, percent: 0, sizeMb: 157 } };
const voiceTarget = () => (S.mini === 'bar' ? $('compact-input') : $('ask'));
function paintMic() {
  const b = document.querySelector('#mic-slot .tool-btn');
  if (!b) return;
  b.classList.toggle('rec', VOICE.state === 'rec');
  b.classList.toggle('busy', VOICE.state === 'busy');
  b.title = VOICE.state === 'rec' ? 'Listening… let go to finish' : VOICE.state === 'busy' ? 'Turning speech into text…' : VOICE.status.installed ? `Hold to talk (or hold ${keyHint('voice')})` : 'Voice: set up hold to talk';
  if (S.mini === 'bar' && VOICE.state !== 'idle') $('compact-status').textContent = VOICE.state === 'rec' ? 'Listening' : 'Transcribing';
}
function wavFrom(samples) { // Float32 mono at 16 kHz -> 16-bit PCM WAV
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Uint8Array(buf);
}
async function toWav(blob) {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * 16000)), 16000);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    return wavFrom((await off.startRendering()).getChannelData(0));
  } finally { ctx.close(); }
}
async function voiceStart() {
  if (VOICE.state !== 'idle') return;
  if (!VOICE.status.installed) return openVoiceSetup();
  VOICE.state = 'rec'; VOICE.startedAt = Date.now(); VOICE.chunks = []; paintMic();
  try {
    VOICE.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    if (VOICE.state !== 'rec') { VOICE.stream.getTracks().forEach((t) => t.stop()); VOICE.stream = null; return; } // let go before the microphone opened
    VOICE.rec = new MediaRecorder(VOICE.stream);
    VOICE.rec.ondataavailable = (e) => { if (e.data.size) VOICE.chunks.push(e.data); };
    VOICE.rec.onstop = voiceFinish;
    VOICE.rec.start();
  } catch {
    VOICE.state = 'idle'; paintMic();
    toast('Rook could not use the microphone. Check Windows Settings › Privacy › Microphone.', { error: true });
  }
}
function voiceStop() {
  if (VOICE.state !== 'rec') return;
  if (VOICE.rec && VOICE.rec.state === 'recording') VOICE.rec.stop(); // voiceFinish runs when the last sound has been handed over
  else { VOICE.state = 'idle'; paintMic(); }
}
async function voiceFinish() {
  const held = Date.now() - VOICE.startedAt, type = VOICE.rec.mimeType;
  VOICE.stream.getTracks().forEach((t) => t.stop()); VOICE.stream = null; VOICE.rec = null;
  if (held < 350) { VOICE.state = 'idle'; paintMic(); return toast('Hold the button while you speak, then let go.'); }
  VOICE.state = 'busy'; paintMic();
  try {
    const text = await VA.voice.transcribe(await toWav(new Blob(VOICE.chunks, { type })));
    if (!text) toast('Nothing was heard.');
    else {
      const el = voiceTarget(), at = el.selectionStart ?? el.value.length, before = el.value.slice(0, at), after = el.value.slice(el.selectionEnd ?? at);
      el.value = before + (before && !/\s$/.test(before) ? ' ' : '') + text + (after && !/^\s/.test(after) ? ' ' : '') + after;
      el.dispatchEvent(new Event('input'));
      el.focus();
    }
  } catch { toast('That recording could not be turned into text.', { error: true }); }
  VOICE.state = 'idle'; paintMic(); paintAsk();
}
// First use: offer the one-time download, with Windows voice typing as the other way.
function openVoiceSetup() {
  if (S.mini === 'bar') setMini('panel');
  const st = VOICE.status;
  const install = async () => {
    VOICE.status = { ...st, installing: true, percent: 0 }; openVoiceSetup();
    const r = await VA.voice.install();
    VOICE.status = await VA.voice.status();
    if (r.ok) { closePop(); paintMic(); toast('Voice is ready. Hold the microphone button and speak.'); }
    else { toast(`Voice could not be set up: ${r.error}`, { error: true }); if (popKind === 'voice') openVoiceSetup(); }
    if (S.view === 'settings') paintSettings();
  };
  showPop('voice',
    h('div', { cls: 'pop-head' }, h('span', { cls: 'eyebrow', text: 'Voice' }), tool('x', 'Close', () => { closePop(); focusAsk(); })),
    h('p', { cls: 'pop-text', text: st.installing ? `Downloading… ${st.percent}%` : `Hold to talk turns speech into text on this PC; nothing is sent anywhere. It needs a one-time download of about ${st.sizeMb} MB.` }),
    st.installing ? h('div', { cls: 'pop-bar' }, h('span', { style: `width:${st.percent}%` }))
      : h('div', { cls: 'pop-acts' }, pill('pill-ghost', 'Use Windows voice typing', () => { closePop(); voiceTarget().focus(); VA.voice.windows(); }), pill('pill pill-accent', 'Download', install)));
}
function onVoiceProgress(st) {
  VOICE.status = st;
  if (popKind === 'voice' && st.installing) openVoiceSetup();
  const line = $('voice-line'); if (line && st.installing) line.textContent = `Downloading… ${st.percent}%`;
}

// ---------- theme and text size ----------
function applyTheme() {
  const t = S.cfg.theme;
  const light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  const next = light ? 'light' : 'dark';
  const changed = document.documentElement.dataset.theme !== next;
  document.documentElement.dataset.theme = next;
  VA.setTextSize(S.cfg.textSize);
  if (changed && S.view === 'notes' && S.pane === 'map') { S.graphStale = true; paintPane(); } // the map is drawn on a canvas: redraw it in the new colours
}

// Esc and other keys for whatever is floating on top. Returns true when the key was used.
function overlayKey(e) {
  if (e.key !== 'Escape') return false;
  if (closeModal()) return true;
  if (closePop()) { focusAsk(); return true; }
  return false;
}

// ---------- first-run setup ----------
// Shown until the vault, the Claude CLI path and a name are saved. Not dismissable: nothing works without them.
async function openSetup() {
  const layer = h('div', { cls: 'setup-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up Rook' });
  document.body.append(layer);
  layer.append(h('div', { cls: 'setup-card' }, h('h2', { text: 'Setting up Rook' }), h('p', { cls: 'sp-help', text: 'Looking at this PC for your vault and the Claude CLI…' })));
  const found = await VA.setup.detect().catch(() => ({ name: '', vaults: [], claudePath: '', wsl: true }));

  const name = h('input', { cls: 'sp-input', value: S.cfg.name || found.name || '', 'aria-label': 'Your name', placeholder: 'What should Rook call you?' });
  const vault = h('input', { cls: 'sp-input mono', value: S.cfg.vaultWin || found.vaults[0] || '', 'aria-label': 'Vault folder', spellcheck: 'false' });
  const vaultHelp = h('p', { cls: 'sp-help' }), vaultAct = h('div', { cls: 'sp-row' });
  const claude = h('input', { cls: 'sp-input mono', value: S.cfg.claudePath || found.claudePath || '', 'aria-label': 'Claude CLI path', spellcheck: 'false', placeholder: '/home/you/.local/bin/claude' });
  const claudeHelp = h('p', { cls: 'sp-help' });
  const done = h('button', { type: 'button', cls: 'pill pill-accent', text: 'Start using Rook' });
  let vaultOk = false, claudeOk = false;
  const ready = () => { done.disabled = !(vaultOk && claudeOk && name.value.trim()); };
  const say = (el, ok, text) => { el.className = 'sp-help' + (ok ? '' : ' warn'); el.textContent = text; };

  const checkVault = async () => {
    const dir = vault.value.trim();
    vaultAct.replaceChildren();
    const r = dir ? await VA.vaultInfo(dir) : { ok: false, reason: 'Choose the folder of your Obsidian vault.' };
    vaultOk = r.ok;
    if (r.ok) say(vaultHelp, true, `Obsidian vault found · ${num(r.notes)} notes in ${num(r.folders)} folders.`);
    else if (dir) {
      say(vaultHelp, false, `${r.reason} Pick another folder, or make a new vault here.`);
      vaultAct.append(pill('pill-ghost', 'Create a new vault here', async () => {
        const c = await VA.createVault(dir);
        if (!c.ok) return say(vaultHelp, false, c.reason);
        checkVault();
      }));
    } else say(vaultHelp, false, r.reason);
    ready();
  };
  const checkClaude = async () => {
    claudeOk = false; ready();
    if (!found.wsl) return say(claudeHelp, false, 'WSL was not found. Rook runs Claude Code inside WSL: install WSL, then Claude Code in it.');
    if (!claude.value.trim()) return say(claudeHelp, false, 'Claude Code was not found in WSL. Install it there (see claude.com/claude-code), then type its path here.');
    say(claudeHelp, true, 'Checking…');
    const r = await VA.setup.checkClaude(claude.value);
    claudeOk = r.ok;
    say(claudeHelp, r.ok, r.ok ? `Claude Code found · ${r.version}` : r.reason);
    ready();
  };
  vault.addEventListener('change', checkVault);
  claude.addEventListener('change', checkClaude);
  name.addEventListener('input', ready);
  done.addEventListener('click', async () => {
    if (done.disabled) return;
    S.cfg = await VA.setConfig({ ...S.cfg, name: name.value, vaultWin: vault.value.trim(), claudePath: claude.value.trim() });
    layer.remove();
    S.note = null; S.graphStale = true; S.treeOpen.clear();
    await loadNotes(); paint(); focusAsk();
  });

  const field = (label, ...kids) => h('div', { cls: 'sp-field' }, h('span', { cls: 'sp-label', text: label }), ...kids);
  layer.replaceChildren(h('div', { cls: 'setup-card' },
    h('h2', { text: 'Welcome to Rook' }),
    h('p', { cls: 'setup-intro', text: 'Three things and you are ready. All of them can be changed later in Settings.' }),
    field('Your name', name),
    field('Obsidian vault', h('div', { cls: 'sp-row' }, vault, pill('pill-ghost', 'Browse', async () => { const p = await VA.pickFolder(); if (p) { vault.value = p; checkVault(); } })), vaultHelp, vaultAct),
    field('Claude CLI path in WSL', claude, claudeHelp),
    h('div', { cls: 'setup-foot' }, done)));
  ready();
  checkVault(); checkClaude();
  name.focus();
}
