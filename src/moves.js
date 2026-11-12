// Moving, renaming and deleting inside the vault. The agent cannot do these itself (shell commands that change
// files are denied, and a rule cannot keep `mv` or `rm` inside the vault), so it asks at the end of its reply:
//   <files>
//   - Python.md -> Learning/Python.md
//   - delete Scratch.md
//   </files>
// and the app does them through the vault guard; deletes go to the Recycle Bin. Pure string work here; the
// files are handled in main.js.
// Loaded by main.js (require) and by the page (window.RookMoves). Tests: test/moves.test.js.
(function (root) {
  const clean = (p) => String(p).trim().replace(/^[`"']|[`"']$/g, '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');

  // Takes the file-actions block out of a reply: <files> (or the older <moves>), one action per line:
  //   - Python.md -> Learning/Python.md     move or rename
  //   - delete Old note.md                  to the Recycle Bin
  // While the block is still streaming in, the partial tag is hidden too.
  function splitMoves(src) {
    src = String(src);
    const m = /<(files|moves)>/.exec(src);
    if (!m) return { text: src.replace(/<(f(i(l(e(s)?)?)?)?|m(o(v(e(s)?)?)?)?)?$/, ''), moves: [] };
    const i = m.index, close = `</${m[1]}>`, j = src.indexOf(close, i);
    const body = j < 0 ? '' : src.slice(i + m[0].length, j);
    const rest = j < 0 ? '' : src.slice(j + close.length);
    const moves = [];
    for (const l of body.split('\n')) {
      const line = l.replace(/^\s*[-*•]\s*/, '').trim();
      const del = !/->|→/.test(line) && /^(?:delete|remove|trash)\s*:?\s+(.+)$/i.exec(line);
      const mv = !del && /^(?:(?:move|rename)\s*:?\s+)?(.+?)\s*(?:->|→)\s*(.+)$/i.exec(line);
      if (del && clean(del[1])) moves.push({ op: 'delete', path: clean(del[1]) });
      else if (mv && clean(mv[1]) && clean(mv[2]) && clean(mv[1]) !== clean(mv[2])) moves.push({ op: 'move', from: clean(mv[1]), to: clean(mv[2]) });
    }
    return { text: (src.slice(0, i).trimEnd() + (rest.trim() ? '\n\n' + rest.trim() : '')), moves: moves.slice(0, 200) };
  }

  // A vault-relative path the app is willing to move to or from: no hidden folders (.obsidian, .claude), no "..".
  const okPath = (p) => !!p && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && p.split('/').every((s) => s && s !== '..' && !s.startsWith('.'));

  const noMd = (p) => p.replace(/\.md$/i, '');
  const base = (p) => p.slice(p.lastIndexOf('/') + 1);

  // Rewrites [[links]] and ![[embeds]] so they still point at moved files. `map` is [{ from, to }] of FILE paths.
  // A link by path ([[Old/Python]], or the end of one) gets the new path; a link by bare name ([[Python]]) still
  // works after a move and changes only when the file's name changed. Heading and alias parts are kept.
  function rewriteLinks(text, map) {
    if (!map.length) return text;
    const L = map.map((m) => ({ ...m, f: m.from.toLowerCase(), fn: noMd(m.from).toLowerCase(), fb: base(m.from).toLowerCase(), fbn: noMd(base(m.from)).toLowerCase() }));
    return String(text).replace(/(!?)\[\[([^\]\n|#]+)([#|][^\]\n]*)?\]\]/g, (all, bang, target, tail) => {
      const t = target.trim().replace(/\\/g, '/').replace(/^\/+/, ''), tl = t.toLowerCase();
      const withExt = /\.[a-z0-9]+$/i.test(t); // the link spells out the extension, so the new one does too
      for (const m of L) {
        let next = null;
        if (t.includes('/')) {
          if (tl === m.f || tl === m.fn || m.f.endsWith('/' + tl) || m.fn.endsWith('/' + tl)) next = withExt ? m.to : noMd(m.to);
        } else if ((tl === m.fb || tl === m.fbn) && base(m.from) !== base(m.to)) next = withExt ? base(m.to) : noMd(base(m.to));
        if (next != null) return `${bang}[[${next}${tail || ''}]]`;
      }
      return all;
    });
  }

  const api = { splitMoves, okPath, rewriteLinks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RookMoves = api;
})(this);
