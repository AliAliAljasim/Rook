const log = document.getElementById('log'), p = document.getElementById('p'), go = document.getElementById('go');
let sessionId = null, cur = null, busy = false;

function add(cls, text) {
  const d = document.createElement('div'); d.className = cls; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
function setBusy(b) { busy = b; go.textContent = b ? 'Stop' : 'Send'; }

function submit() {
  if (busy) { window.api.cancel(); return; }
  const text = p.value.trim(); if (!text) return;
  add('m user', text); p.value = ''; cur = null; setBusy(true);
  window.api.send(text, sessionId);
}
document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
p.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
document.getElementById('new').onclick = () => { sessionId = null; log.innerHTML = ''; };

window.api.onEvent((ev) => {
  if (ev.session_id) sessionId = ev.session_id;
  if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') {
    cur = cur || add('m', ''); cur.textContent += ev.event.delta.text; log.scrollTop = log.scrollHeight;
  } else if (ev.type === 'assistant') {
    for (const b of ev.message?.content || [])
      if (b.type === 'tool_use') { cur = null; add('tool', `▸ ${b.name} ${b.input.file_path || b.input.pattern || b.input.command || ''}`); }
    cur = null; // next text block starts a new bubble
  } else if (ev.type === 'user') {
    for (const b of ev.message?.content || [])
      if (b.type === 'tool_result' && b.is_error) add('tool err', '✖ blocked/failed: ' + String(b.content).slice(0, 200));
  } else if (ev.type === 'error') add('m err', ev.text);
  else if (ev.type === 'done') { if (ev.code) add('m err', `claude exited ${ev.code}\n${ev.stderr}`); setBusy(false); cur = null; }
});

const d = document.getElementById('d');
document.getElementById('cfg').onclick = async () => {
  const c = await window.api.getConfig();
  document.getElementById('vault').value = c.vaultWin; document.getElementById('claude').value = c.claudePath; d.showModal();
};
d.addEventListener('close', () => window.api.setConfig({ vaultWin: document.getElementById('vault').value, claudePath: document.getElementById('claude').value }));
