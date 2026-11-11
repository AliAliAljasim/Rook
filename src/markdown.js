// Small, safe markdown renderer: builds DOM nodes (never innerHTML). Supports headings, lists,
// task lists, blockquotes, tables, fenced code, hr, **bold**, *italic*, `code`, [text](url), [[wiki-links]].
(function () {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  function inline(parent, s, ctx) {
    const re = /(\[\[[^\]\n]+\]\]|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) parent.append(s.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('[[')) {
        const name = t.slice(2, -2).split('|')[0].trim();
        const label = t.slice(2, -2).split('|').pop().trim();
        const a = el('a', 'va-wikilink', label); a.href = '#'; a.dataset.note = name;
        a.addEventListener('click', (e) => { e.preventDefault(); ctx.openNote(name); });
        parent.append(a);
      } else if (t[0] === '`') parent.append(el('code', null, t.slice(1, -1)));
      else if (t.startsWith('**')) { const b = el('strong'); inline(b, t.slice(2, -2), ctx); parent.append(b); }
      else if (t[0] === '*') { const b = el('em'); inline(b, t.slice(1, -1), ctx); parent.append(b); }
      else {
        const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(t);
        const a = el('a', null, mm[1]); a.href = mm[2];
        a.addEventListener('click', (e) => { e.preventDefault(); ctx.openUrl(mm[2]); });
        parent.append(a);
      }
      last = m.index + t.length;
    }
    if (last < s.length) parent.append(s.slice(last));
  }

  function codeBlock(lang, code, ctx) {
    const box = el('div', 'va-code');
    const head = el('div', 'va-code__head');
    head.append(el('span', 'va-kicker', lang || 'text'));
    const btn = el('button', 'va-btn va-btn--ghost va-code__copy', 'Copy'); btn.type = 'button';
    btn.addEventListener('click', () => { ctx.copy(code); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1600); });
    head.append(btn);
    const pre = el('pre'); pre.append(el('code', null, code));
    box.append(head, pre);
    return box;
  }

  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

  function render(text, ctx) {
    const root = el('div', 'va-md');
    const lines = String(text).replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = /^```\s*([\w+-]*)\s*$/.exec(line))) {
        const buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++; root.append(codeBlock(m[1], buf.join('\n'), ctx)); continue;
      }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        const h = el('h' + Math.min(m[1].length, 3)); inline(h, m[2], ctx); root.append(h); i++; continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { root.append(el('hr')); i++; continue; }
      if (/^>\s?/.test(line)) {
        const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        const q = el('blockquote'); inline(q, buf.join(' '), ctx); root.append(q); continue;
      }
      if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const head = cells(line); i += 2;
        const rows = []; while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
        const t = el('table'), thead = el('thead'), tr = el('tr');
        head.forEach((c) => { const th = el('th'); inline(th, c, ctx); tr.append(th); });
        thead.append(tr); t.append(thead);
        const tb = el('tbody');
        rows.forEach((r) => { const rr = el('tr'); r.forEach((c) => { const td = el('td', /^[\d.,%$€£-]+$/.test(c) ? 'num' : null); inline(td, c, ctx); rr.append(td); }); tb.append(rr); });
        t.append(tb); root.append(t); continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        const tasks = items.every((x) => /^\[[ xX]\]\s/.test(x));
        const list = el(ordered ? 'ol' : 'ul', tasks ? 'va-tasks' : null);
        items.forEach((x) => {
          const li = el('li');
          if (tasks) {
            const lab = el('label', 'va-check'), cb = el('input'); cb.type = 'checkbox'; cb.checked = /^\[[xX]\]/.test(x); cb.disabled = true;
            const sp = el('span'); inline(sp, x.replace(/^\[[ xX]\]\s/, ''), ctx); lab.append(cb, sp); li.append(lab);
          } else inline(li, x, ctx);
          list.append(li);
        });
        root.append(list); continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\s*([-*+]|\d+\.)\s+|\s*(---|\*\*\*|___)\s*$)/.test(lines[i]) && !(isRow(lines[i]) && isSep(lines[i + 1] || ''))) buf.push(lines[i++]);
      const p = el('p'); inline(p, buf.join(' '), ctx); root.append(p);
    }
    return root;
  }
  window.VAMarkdown = { render };
})();
