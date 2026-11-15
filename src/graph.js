// The Map: a force-directed graph of notes (dots) and [[links]] (lines), drawn on a canvas.
// Pan by dragging the background, zoom with the wheel, drag a dot to move it, click a dot to select it.
// Kinds: notes are dots, attachments small squares, links to notes that do not exist hollow rings. Hidden notes
// (shown only when asked) are faint; notes Rook changed carry a pulsing accent ring.
(function () {
  // Colours come from the stylesheet's variables, so the map follows the light or dark theme.
  let palKey = null, pal = null;
  function colours() {
    const key = document.documentElement.dataset.theme || 'dark';
    if (key === palKey) return pal;
    const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
    const fgRgb = key === 'light' ? '42,38,34' : '238,232,223';
    palKey = key;
    pal = { accent: v('--accent'), fg: v('--fg'), node: v('--graph-node'), orphan: v('--graph-orphan'),
      accentRgb: v('--accent-rgb'), bg: v('--bg'), muted: v('--muted-2') || v('--graph-orphan'),
      edgeOn: `rgba(${v('--accent-rgb')},.7)`, edge: `rgba(${v('--ov')},${key === 'light' ? .2 : .11})`, edgeDim: `rgba(${v('--ov')},${key === 'light' ? .07 : .035})`, label: `rgba(${fgRgb},.72)` };
    return pal;
  }

  function create(canvas, data, opts) {
    const ctx = canvas.getContext('2d');
    const reduce = document.documentElement.dataset.motion === 'reduce';
    const n = data.nodes.length;
    const known = opts.positions || new Map(); // where the dots were last time, so a rebuilt map does not jump
    let placed = 0;
    const nodes = data.nodes.map((d, i) => {
      const a = i * 2.399963, r = 26 * Math.sqrt(i + 1); // sunflower start: spread out, deterministic
      const p = known.get(d.id); if (p) placed++;
      return { ...d, i, x: p ? p.x : Math.cos(a) * r, y: p ? p.y : Math.sin(a) * r, vx: 0, vy: 0, deg: 0, nb: new Set() };
    });
    const edges = data.edges.map(([a, b]) => { nodes[a].deg++; nodes[b].deg++; nodes[a].nb.add(b); nodes[b].nb.add(a); return [nodes[a], nodes[b]]; });
    nodes.forEach((d) => { d.r = (d.kind && d.kind !== 'note' ? 2.5 : 3) + Math.min(9, Math.sqrt(d.deg) * 1.7); });
    let changed = new Map(opts.changed || []); // id -> what Rook did to it

    // A map rebuilt with the same notes starts nearly settled, from where it was.
    let scale = 1, tx = 0, ty = 0, alpha = n && placed / n > 0.8 ? 0.12 : 1, raf = 0, dead = false;
    if (opts.view) ({ scale, tx, ty } = opts.view);
    let hover = null, selected = null, filter = '', drag = null, moved = false, w = 0, h = 0;

    function tick() {
      const sample = n > 900 ? 220 : 0; // big vaults: repel against a random sample each tick
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        const count = sample || n;
        for (let k = 0; k < count; k++) {
          const b = sample ? nodes[(Math.random() * n) | 0] : nodes[k];
          if (b === a) continue;
          let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
          if (d2 > 160000) continue;
          const f = (sample ? 2600 * (n / sample) : 2600) / d2 * alpha;
          a.vx += dx * f * 0.05; a.vy += dy * f * 0.05;
        }
        a.vx -= a.x * 0.004 * alpha; a.vy -= a.y * 0.004 * alpha; // gentle pull to the middle
      }
      for (const [a, b] of edges) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 95) * 0.012 * alpha, fx = dx / d * f, fy = dy / d * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const d of nodes) {
        if (drag && drag.node === d) { d.vx = d.vy = 0; continue; }
        d.vx *= 0.82; d.vy *= 0.82;
        d.x += Math.max(-30, Math.min(30, d.vx)); d.y += Math.max(-30, Math.min(30, d.vy));
      }
      alpha *= 0.985;
    }

    function fit() {
      if (!n) return;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const d of nodes) { x0 = Math.min(x0, d.x); x1 = Math.max(x1, d.x); y0 = Math.min(y0, d.y); y1 = Math.max(y1, d.y); }
      const pad = 90;
      scale = Math.max(0.15, Math.min(2.2, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
      tx = w / 2 - (x0 + x1) / 2 * scale; ty = h / 2 - (y0 + y1) / 2 * scale;
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(tx, ty); ctx.scale(scale, scale);
      const focus = hover || selected;
      const C = colours(), ACCENT = C.accent, FG = C.fg, NODE = C.node, ORPHAN = C.orphan;
      const lit = (d) => !focus || d === focus || focus.nb.has(d.i);
      const match = (d) => !filter || d.title.toLowerCase().includes(filter);
      const pulse = reduce ? 0.5 : (Math.sin(performance.now() / 420) + 1) / 2;
      ctx.lineWidth = 1 / scale;
      for (const [a, b] of edges) {
        const on = focus && (a === focus || b === focus);
        ctx.strokeStyle = on ? C.edgeOn : focus || (filter && !(match(a) && match(b))) ? C.edgeDim : C.edge;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const d of nodes) {
        const dim = !lit(d) || !match(d);
        const r = d.r / Math.sqrt(scale);
        ctx.globalAlpha = (dim ? 0.22 : 1) * (d.hidden ? 0.45 : 1);
        const fill = d === focus || d === selected || (filter && match(d)) ? ACCENT : d.kind === 'file' ? C.muted : d.deg ? NODE : ORPHAN;
        if (d.kind === 'missing') {
          ctx.strokeStyle = fill; ctx.lineWidth = 1.4 / scale; ctx.setLineDash([2 / scale, 2 / scale]);
          ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1 / scale;
        } else if (d.kind === 'file') {
          ctx.fillStyle = fill; ctx.fillRect(d.x - r * 0.85, d.y - r * 0.85, r * 1.7, r * 1.7);
        } else { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.fill(); }
        if (d.hidden) {
          ctx.strokeStyle = fill; ctx.lineWidth = 1 / scale; ctx.setLineDash([3 / scale, 3 / scale]);
          ctx.beginPath(); ctx.arc(d.x, d.y, r + 3 / scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        if (changed.has(d.id)) {
          ctx.globalAlpha = dim ? 0.3 : 1;
          ctx.strokeStyle = `rgba(${C.accentRgb},${0.35 + 0.5 * (1 - pulse)})`; ctx.lineWidth = 2 / scale;
          ctx.beginPath(); ctx.arc(d.x, d.y, r + (4 + 5 * pulse) / scale, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1 / scale;
        }
        if (d === selected) { ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5 / scale; ctx.beginPath(); ctx.arc(d.x, d.y, d.r / Math.sqrt(scale) + 4 / scale, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1 / scale; }
      }
      ctx.globalAlpha = 1;
      // Names only on hover: the note under the pointer and the notes linked to it (or the matches while searching).
      // Each sits on a small backing so it stays readable over lines and dots.
      ctx.font = `${12 / scale}px "Instrument Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const d of nodes) {
        const show = hover ? (d === hover || hover.nb.has(d.i)) : filter ? match(d) : false;
        if (!show) continue;
        const t = d.title.length > 30 ? d.title.slice(0, 29) + '…' : d.title;
        const tw = ctx.measureText(t).width, ly = d.y + d.r / Math.sqrt(scale) + 5 / scale, px = 4 / scale;
        ctx.fillStyle = C.bg; ctx.globalAlpha = 0.82;
        ctx.fillRect(d.x - tw / 2 - px, ly - 2 / scale, tw + px * 2, 16 / scale);
        ctx.globalAlpha = 1;
        ctx.fillStyle = d === hover ? FG : C.label;
        ctx.fillText(t, d.x, d.y + d.r / Math.sqrt(scale) + 5 / scale);
      }
    }

    function frame() {
      raf = 0;
      if (dead) return;
      if (alpha > 0.02) { tick(); if (!userMoved) fit(); }
      draw();
      // Changed notes pulse, so the map keeps drawing while there are any (and the page is visible).
      if (alpha > 0.02 || drag || (changed.size && !reduce && canvas.isConnected && canvas.offsetParent)) raf = requestAnimationFrame(frame);
    }
    let userMoved = false;
    const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(frame); };

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (!r.width || !r.height) return;
      const first = !w;
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if ((first && !opts.view) || (!first && !userMoved)) fit(); // the note panel opening or closing re-centres an untouched map
      draw(); kick();
    }
    const ro = new ResizeObserver(resize); ro.observe(canvas);

    const toWorld = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - tx) / scale, y: (e.clientY - r.top - ty) / scale }; };
    function pick(e) {
      const p = toWorld(e); let best = null, bd = Infinity;
      for (const d of nodes) {
        const dx = d.x - p.x, dy = d.y - p.y, dist = Math.sqrt(dx * dx + dy * dy), reach = d.r / Math.sqrt(scale) + 6 / scale;
        if (dist < reach && dist < bd) { best = d; bd = dist; }
      }
      return best;
    }
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId); moved = false;
      const node = pick(e);
      drag = { node, sx: e.clientX, sy: e.clientY, tx, ty };
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag) {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) moved = true;
        if (drag.node) { const p = toWorld(e); drag.node.x = p.x; drag.node.y = p.y; if (moved) alpha = Math.max(alpha, 0.25); }
        else { tx = drag.tx + e.clientX - drag.sx; ty = drag.ty + e.clientY - drag.sy; userMoved = true; }
        kick(); draw(); return;
      }
      const hit = pick(e);
      if (hit !== hover) { hover = hit; canvas.classList.toggle('pointing', !!hit); draw(); }
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = drag; drag = null; canvas.classList.remove('grabbing');
      if (d && !moved) { selected = d.node || null; opts.onSelect && opts.onSelect(selected ? info(selected) : null); draw(); }
    });
    canvas.addEventListener('pointerleave', () => { if (hover && !drag) { hover = null; draw(); } });
    canvas.addEventListener('contextmenu', (e) => { const d = pick(e); if (d && opts.onContext) opts.onContext(e, info(d)); else e.preventDefault(); });
    canvas.addEventListener('dblclick', (e) => { const d = pick(e); if (d && opts.onOpen) opts.onOpen(d.id); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      zoomAt(mx, my, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    function zoomAt(mx, my, k) {
      const ns = Math.max(0.1, Math.min(5, scale * k));
      tx = mx - (mx - tx) * (ns / scale); ty = my - (my - ty) * (ns / scale); scale = ns; userMoved = true; draw();
    }
    const info = (d) => ({ id: d.id, title: d.title, folder: d.folder, links: d.deg, kind: d.kind || 'note', hidden: !!d.hidden, changed: changed.get(d.id) || null });

    if (reduce && alpha === 1) { for (let k = 0; k < 260; k++) tick(); alpha = 0; }
    if (opts.view) userMoved = true;
    resize(); kick();

    return {
      destroy() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); },
      zoom(k) { zoomAt(w / 2, h / 2, k); },
      fit() { userMoved = false; fit(); draw(); },
      setFilter(q) { filter = String(q || '').toLowerCase().trim(); draw(); },
      // quiet: the page already knows (it opened the note itself); only move the view if the dot is out of sight.
      select(id, quiet) {
        const d = nodes.find((x) => x.id === id) || null;
        selected = d;
        if (!quiet) opts.onSelect && opts.onSelect(d ? info(d) : null);
        if (d && w) {
          const sx = d.x * scale + tx, sy = d.y * scale + ty, edge = 60;
          if (!quiet) { fit(); userMoved = true; scale = Math.min(1.6, Math.max(scale, 1.15)); tx = w / 2 - d.x * scale; ty = h / 2 - d.y * scale; }
          else if (sx < edge || sx > w - edge || sy < edge || sy > h - edge) { userMoved = true; tx = w / 2 - d.x * scale; ty = h / 2 - d.y * scale; }
        }
        draw();
      },
      settle() { for (let k = 0; k < 260; k++) tick(); alpha = 0; fit(); draw(); },
      wake() { kick(); },
      setChanged(m) { changed = new Map(m || []); draw(); kick(); },
      positions() { return new Map(nodes.map((d) => [d.id, { x: d.x, y: d.y }])); },
      view() { return userMoved ? { scale, tx, ty } : null; },
      selected() { return selected ? selected.id : null; },
      counts: { notes: n, links: edges.length }
    };
  }
  window.RookGraph = { create };
})();
