// Safe markdown renderer: builds DOM nodes (never innerHTML). Used for replies and the note viewer.
// Supports: frontmatter, headings, nested lists, task lists, blockquotes, Obsidian callouts, tables, fenced code,
// hr, **bold**, *italic*, ~~strike~~, ==highlight==, `code`, [text](url), [[wiki-links|alias]], ![[embeds]], #tags.
(function () {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const INLINE = /(!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\)|\[\[[^\]\n]+\]\]|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|(?<=^|\s)#[A-Za-z][\w/-]*)/g;
  function inline(parent, s, ctx) {
    let last = 0, m;
    const re = new RegExp(INLINE.source, 'g'); // own cursor: inline() recurses for bold/italic
    while ((m = re.exec(s))) {
      if (m.index > last) parent.append(s.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('![[') || t.startsWith('![')) {
        const name = t.startsWith('![[') ? t.slice(3, -2).split('|')[0] : (/\(([^)]+)\)/.exec(t) || [])[1] || '';
        if (t.startsWith('![[') && !/\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp3|mp4|mov|wav)$/i.test(name)) wikilink(parent, name, name, ctx);
        else { const e = el('span', 'embed'); if (ctx.icon) e.append(ctx.icon('image')); e.append(name.split('/').pop()); parent.append(e); }
      } else if (t.startsWith('[[')) {
        const inner = t.slice(2, -2), bar = inner.indexOf('|');
        wikilink(parent, bar < 0 ? inner : inner.slice(0, bar), bar < 0 ? inner.replace(/#/g, ' › ') : inner.slice(bar + 1), ctx);
      } else if (t[0] === '`') parent.append(el('code', null, t.slice(1, -1)));
      else if (t.startsWith('**') || t.startsWith('__')) { const b = el('strong'); inline(b, t.slice(2, -2), ctx); parent.append(b); }
      else if (t.startsWith('~~')) { const b = el('del'); inline(b, t.slice(2, -2), ctx); parent.append(b); }
      else if (t.startsWith('==')) { const b = el('mark'); inline(b, t.slice(2, -2), ctx); parent.append(b); }
      else if (t[0] === '*') { const b = el('em'); inline(b, t.slice(1, -1), ctx); parent.append(b); }
      else if (t[0] === '#') parent.append(el('span', 'tag', t));
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
  function wikilink(parent, target, label, ctx) {
    const name = target.split('#')[0].trim() || target.trim();
    const a = el('a', 'wikilink', label.trim());
    if (ctx.exists && !ctx.exists(name)) a.classList.add('missing');
    a.href = '#'; a.title = name;
    a.addEventListener('click', (e) => { e.preventDefault(); ctx.openNote(name); });
    parent.append(a);
  }
  // Paragraph text: in notes a single newline is a line break (Obsidian's default); in replies it is a space.
  function para(parent, lines, ctx) {
    if (!ctx.breaks) return inline(parent, lines.join(' '), ctx);
    lines.forEach((l, i) => { if (i) parent.append(el('br')); inline(parent, l, ctx); });
  }

  function codeBlock(lang, code, ctx) {
    const box = el('div', 'code');
    const head = el('div', 'code-head');
    head.append(el('span', null, lang || 'text'));
    const btn = el('button', 'code-copy', 'Copy'); btn.type = 'button';
    btn.addEventListener('click', () => { ctx.copy(code); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1600); });
    head.append(btn);
    const pre = el('pre'); pre.append(el('code', null, code));
    box.append(head, pre);
    return box;
  }

  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const indentOf = (s) => s.replace(/\t/g, '    ').length;

  // Builds nested lists from indentation. Returns the index after the list.
  function list(lines, i, root, ctx) {
    const stack = []; // { indent, node, li }
    while (i < lines.length) {
      const m = LIST.exec(lines[i]);
      if (!m) {
        // a continuation line belongs to the last item
        if (lines[i].trim() && stack.length && indentOf(/^\s*/.exec(lines[i])[0]) > stack[stack.length - 1].indent) {
          const li = stack[stack.length - 1].li; li.append(' '); inline(li.querySelector(':scope > .task > span') || li, lines[i].trim(), ctx); i++; continue;
        }
        break;
      }
      const indent = indentOf(m[1]), ordered = /\d/.test(m[2]);
      while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || indent > top.indent) {
        const node = el(ordered ? 'ol' : 'ul');
        (top ? top.li : root).append(node);
        top = { indent, node, li: null }; stack.push(top);
      }
      const li = el('li');
      const task = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
      if (task) {
        top.node.classList.add('tasks');
        const done = task[1] !== ' ';
        const lab = el('label', 'task' + (done ? ' done' : '')), cb = el('input'); cb.type = 'checkbox'; cb.checked = done; cb.disabled = true;
        const sp = el('span'); inline(sp, task[2], ctx); lab.append(cb, sp); li.append(lab);
      } else inline(li, m[3], ctx);
      top.node.append(li); top.li = li;
      i++;
    }
    return i;
  }

  function frontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return { body: text, props: [] };
    const props = []; let cur = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line), item = /^\s*-\s+(.*)$/.exec(line);
      if (kv) { cur = { key: kv[1], value: kv[2].replace(/^\[|\]$/g, '').replace(/^["']|["']$/g, '') }; props.push(cur); }
      else if (item && cur) cur.value = (cur.value ? cur.value + ', ' : '') + item[1].replace(/^["']|["']$/g, '');
    }
    return { body: text.slice(m[0].length), props: props.filter((p) => p.value) };
  }

  function render(text, ctx) {
    const root = el('div', 'md');
    let src = String(text).replace(/\r/g, '').replace(/%%[\s\S]*?%%/g, '');
    if (ctx.frontmatter) {
      const fm = frontmatter(src); src = fm.body;
      if (fm.props.length) {
        const box = el('div', 'props');
        fm.props.slice(0, 12).forEach((p) => { const c = el('span', 'prop'); c.append(el('b', null, p.key), el('span', null, p.value)); box.append(c); });
        root.append(box);
      }
    }
    const lines = src.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/.exec(line))) {
        const fence = m[1], buf = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++; root.append(codeBlock(m[2], buf.join('\n'), ctx)); continue;
      }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line))) {
        const h = el('h' + Math.min(m[1].length, 4)); inline(h, m[2], ctx); root.append(h); i++; continue;
      }
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { root.append(el('hr')); i++; continue; }
      if (/^\s*>/.test(line)) {
        const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        const c = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(buf[0] || '');
        if (c) {
          const box = el('div', 'callout'); box.append(el('div', 'callout-title', c[2] || c[1]));
          const body = el('div'); para(body, buf.slice(1).filter((x) => x.trim()), ctx); box.append(body); root.append(box);
        } else { const q = el('blockquote'); para(q, buf.filter((x) => x.trim()), ctx); root.append(q); }
        continue;
      }
      if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const head = cells(line); i += 2;
        const rows = []; while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
        const t = el('table'), thead = el('thead'), tr = el('tr');
        head.forEach((c) => { const th = el('th'); inline(th, c, ctx); tr.append(th); });
        thead.append(tr); t.append(thead);
        const tb = el('tbody');
        rows.forEach((r) => { const rr = el('tr'); r.forEach((c) => { const td = el('td', /^[\d.,%$€£ -]+$/.test(c) && /\d/.test(c) ? 'num' : null); inline(td, c, ctx); rr.append(td); }); tb.append(rr); });
        t.append(tb); root.append(t); continue;
      }
      if (LIST.test(line)) { i = list(lines, i, root, ctx); continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(\s*(```|~~~)|#{1,6}\s|\s*>|\s*(---+|\*\*\*+|___+)\s*$)/.test(lines[i]) && !LIST.test(lines[i]) && !(isRow(lines[i]) && isSep(lines[i + 1] || ''))) buf.push(lines[i++].trim());
      if (!buf.length) buf.push(lines[i++].trim()); // never stall on an odd line
      const p = el('p'); para(p, buf, ctx); root.append(p);
    }
    return root;
  }
  // Plain-text link targets in a note (for counts).
  const links = (text) => [...String(text).matchAll(/\[\[([^\]\n|#]+)/g)].map((m) => m[1].trim());
  window.RookMarkdown = { render, links };
})();
